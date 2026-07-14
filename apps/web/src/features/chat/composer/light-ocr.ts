import type { FileUIPart } from 'ai'

import { getServerUrl } from '~/lib/electron'
import { cradleFetch } from '~/lib/server-credential'

interface LightOcrResponse {
  items: Array<{
    index: number
    text: string
    lineCount: number
    modelBundleId: string
  }>
}

interface LightOcrErrorResponse {
  message?: string
}

type LightOcrFilePart = FileUIPart & {
  providerMetadata?: Record<string, unknown>
}

function isImageAttachment(file: FileUIPart): boolean {
  return file.mediaType.startsWith('image/')
}

function withLightOcrMetadata(
  file: FileUIPart,
  item: LightOcrResponse['items'][number],
): FileUIPart {
  const metadata = (file as LightOcrFilePart).providerMetadata ?? {}
  const cradle = typeof metadata.cradle === 'object' && metadata.cradle !== null
    ? (metadata.cradle as Record<string, unknown>)
    : {}
  return {
    ...file,
    providerMetadata: {
      ...metadata,
      cradle: {
        ...cradle,
        lightOcr: {
          version: 1,
          text: item.text,
          lineCount: item.lineCount,
          modelBundleId: item.modelBundleId,
        },
      },
    },
  }
}

export async function prepareLightOcrAttachments(files: FileUIPart[]): Promise<FileUIPart[]> {
  const images = files.filter(isImageAttachment)
  if (images.length === 0) {
    return files
  }

  const response = await cradleFetch(new URL('/image-ocr/recognize', getServerUrl()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: images }),
  })
  const payload = (await response.json().catch(() => null)) as
    | LightOcrResponse
    | LightOcrErrorResponse
    | null
  if (!response.ok || !payload || !('items' in payload)) {
    const detail
      = payload && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Local image text recognition failed (${response.status}).`
    throw new Error(detail)
  }

  const itemsByIndex = new Map(payload.items.map(item => [item.index, item]))
  let imageIndex = 0
  return files.map((file) => {
    if (!isImageAttachment(file)) {
      return file
    }
    const item = itemsByIndex.get(imageIndex++)
    if (!item) {
      throw new Error('Local image text recognition returned an incomplete result.')
    }
    return withLightOcrMetadata(file, item)
  })
}
