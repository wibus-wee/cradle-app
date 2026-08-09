import type { FileUIPart } from 'ai'

import { postImageOcrRecognize } from '~/api-gen/sdk.gen'
import type { PostImageOcrRecognizeResponse } from '~/api-gen/types.gen'

type LightOcrFilePart = FileUIPart & {
  providerMetadata?: Record<string, unknown>
}

function isImageAttachment(file: FileUIPart): boolean {
  return file.mediaType.startsWith('image/')
}

function withLightOcrMetadata(
  file: FileUIPart,
  item: PostImageOcrRecognizeResponse['items'][number],
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

  const { data: payload } = await postImageOcrRecognize({
    body: { files: images },
    throwOnError: true,
  })

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
