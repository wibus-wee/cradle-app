import { readFileSync, statSync } from 'node:fs'

const LOCAL_IMAGE_DATA_URL_MAX_BYTES = 24 * 1024 * 1024

export interface LocalImageDataUrl {
  mediaType: string
  url: string
}

export function readLocalImageDataUrl(filePath: string | null | undefined): LocalImageDataUrl | null {
  if (!filePath || filePath.includes('\0')) {
    return null
  }

  try {
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size <= 0 || stats.size > LOCAL_IMAGE_DATA_URL_MAX_BYTES) {
      return null
    }

    const bytes = readFileSync(filePath)
    const mediaType = readImageMediaType(bytes)
    if (!mediaType) {
      return null
    }

    return {
      mediaType,
      url: `data:${mediaType};base64,${bytes.toString('base64')}`,
    }
  }
  catch {
    return null
  }
}

function readImageMediaType(bytes: Buffer): string | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47
    && bytes[4] === 0x0D
    && bytes[5] === 0x0A
    && bytes[6] === 0x1A
    && bytes[7] === 0x0A) {
    return 'image/png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif'
    }
  }

  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }

  return null
}
