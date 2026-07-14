import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createEngine, OcrError } from '@arcships/light-ocr'
import sharp from 'sharp'

import { AppError } from '../../errors/app-error'

export interface ImageOcrFile {
  mediaType: string
  filename?: string
  url: string
}

export interface RecognizedImageText {
  index: number
  text: string
  lineCount: number
  modelBundleId: string
}

const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_COUNT = 8
const BASE64_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i

let enginePromise: ReturnType<typeof createEngine> | null = null

async function getEngine() {
  enginePromise ??= createEngine({
    queueCapacity: 2,
    maxPendingInputBytes: MAX_SOURCE_BYTES * 2,
  })
  const pendingEngine = enginePromise
  try {
    return await pendingEngine
  }
  catch (error) {
    if (enginePromise === pendingEngine) {
      enginePromise = null
    }
    throw error
  }
}

function rejectInvalidImage(message: string, details?: Record<string, unknown>): never {
  throw new AppError({ code: 'image_ocr_invalid_image', status: 422, message, details })
}

function assertImageFile(file: ImageOcrFile): void {
  if (!file.mediaType.startsWith('image/')) {
    rejectInvalidImage('Light OCR accepts image attachments only', { mediaType: file.mediaType })
  }
}

async function readImageBytes(file: ImageOcrFile): Promise<Buffer> {
  const dataUrl = BASE64_DATA_URL_RE.exec(file.url)
  if (dataUrl) {
    const encoded = dataUrl[1]!.replace(/\s/g, '')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
      rejectInvalidImage('Image data exceeds the OCR input limit', { maxBytes: MAX_SOURCE_BYTES })
    }
    return bytes
  }

  if (!file.url.startsWith('file:')) {
    rejectInvalidImage('Light OCR requires a local image attachment')
  }

  let filePath: string
  try {
    filePath = fileURLToPath(file.url)
  }
  catch {
    rejectInvalidImage('Image attachment has an invalid local file URL')
  }
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) {
    rejectInvalidImage('Image attachment is no longer available locally')
  }
  if (info.size > MAX_SOURCE_BYTES) {
    rejectInvalidImage('Image file exceeds the OCR input limit', { maxBytes: MAX_SOURCE_BYTES })
  }
  return await readFile(filePath)
}

async function decodeForLightOcr(bytes: Buffer) {
  try {
    return await sharp(bytes)
      .rotate()
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
  }
 catch {
    rejectInvalidImage('Image format cannot be decoded for OCR')
  }
}

export async function recognizeImages(
  files: ImageOcrFile[],
  signal?: AbortSignal,
): Promise<RecognizedImageText[]> {
  if (files.length > MAX_IMAGE_COUNT) {
    throw new AppError({
      code: 'image_ocr_limit_exceeded',
      status: 413,
      message: `Light OCR accepts at most ${MAX_IMAGE_COUNT} images at once`,
    })
  }

  const engine = await getEngine()
  return await Promise.all(
    files.map(async (file, index) => {
      assertImageFile(file)
      const bytes = await readImageBytes(file)
      const decoded = await decodeForLightOcr(bytes)
      if (decoded.info.channels !== 3) {
        rejectInvalidImage('Image could not be normalized to RGB pixels')
      }
      try {
        const result = await engine.recognize(
          {
            data: decoded.data,
            width: decoded.info.width,
            height: decoded.info.height,
            stride: decoded.info.width * decoded.info.channels,
            pixelFormat: 'rgb8',
          },
          { signal },
        )
        const lines = result.lines.map(line => line.text.trim()).filter(Boolean)
        return {
          index,
          text: lines.join('\n'),
          lineCount: lines.length,
          modelBundleId: result.modelBundleId,
        }
      }
      catch (error) {
        if (error instanceof OcrError) {
          throw new AppError({
            code: 'image_ocr_failed',
            status: error.code === 'resource_limit_exceeded' ? 413 : 422,
            message: `Light OCR could not read this image: ${error.message}`,
            details: { code: error.code },
          })
        }
        throw error
      }
    }),
  )
}

export async function shutdownImageOcr(): Promise<void> {
  const engine = enginePromise
  enginePromise = null
  if (engine) {
    await engine.then(
      instance => instance.close(),
      () => undefined,
    )
  }
}
