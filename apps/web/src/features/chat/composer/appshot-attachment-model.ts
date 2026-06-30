import type { FileUIPart } from 'ai'

export interface CradleAppshotMetadata {
  kind: 'cradle-appshot'
  appName: string | null
  windowTitle: string | null
  bundleIdentifier: string | null
  imageName: string
  imageDataUrl: string
  imagePath: string | null
  transitionSnapshotDataUrl: string | null
  transitionSnapshotHeight: number | null
  appIconDataUrl: string | null
  axTree: string
}

/**
 * What we actually persist on the file part. The screenshot itself lives in the
 * part's `url`; storing it again under `imageDataUrl` doubled the base64 payload
 * retained per message, so the stored shape omits it. Readers reconstitute the
 * full {@link CradleAppshotMetadata} from `part.url`.
 */
export type StoredCradleAppshotMetadata = Omit<CradleAppshotMetadata, 'imageDataUrl'>

export type CradleAppshotFilePart = FileUIPart & {
  providerMetadata?: {
    cradle?: {
      appshot?: StoredCradleAppshotMetadata
    }
  }
}

export interface CreateCradleAppshotFilePartInput {
  mediaType: FileUIPart['mediaType']
  filename: string
  imageDataUrl: string
  imagePath: string | null
  transitionSnapshotDataUrl: string | null
  transitionSnapshotHeight: number | null
  appName: string | null
  windowTitle: string | null
  bundleIdentifier: string | null
  appIconDataUrl?: string | null
  axTree?: string
}

export function createCradleAppshotFilePart(input: CreateCradleAppshotFilePartInput): CradleAppshotFilePart {
  return {
    type: 'file',
    mediaType: input.mediaType,
    filename: input.filename,
    url: input.imageDataUrl,
    providerMetadata: {
      cradle: {
        // The screenshot lives in `url`; readCradleAppshotMetadata falls back to
        // it. Do NOT also store it as `imageDataUrl` here — that doubled the
        // full-resolution base64 payload held in every retained appshot message.
        appshot: {
          kind: 'cradle-appshot',
          appName: input.appName,
          windowTitle: input.windowTitle,
          bundleIdentifier: input.bundleIdentifier,
          imageName: input.filename,
          imagePath: input.imagePath,
          transitionSnapshotDataUrl: input.transitionSnapshotDataUrl,
          transitionSnapshotHeight: input.transitionSnapshotHeight,
          appIconDataUrl: input.appIconDataUrl ?? null,
          axTree: input.axTree ?? '',
        } satisfies StoredCradleAppshotMetadata,
      },
    },
  }
}

export function readCradleAppshotMetadata(part: FileUIPart): CradleAppshotMetadata | null {
  const metadata = readRecord(part.providerMetadata)
  const cradle = readRecord(metadata?.cradle)
  const appshot = readRecord(cradle?.appshot)
  if (!appshot || appshot.kind !== 'cradle-appshot') {
    return null
  }

  const imageDataUrl = readString(appshot.imageDataUrl) ?? part.url
  const imageName = readString(appshot.imageName) ?? part.filename ?? 'AppShot'
  return {
    kind: 'cradle-appshot',
    appName: readString(appshot.appName),
    windowTitle: readString(appshot.windowTitle),
    bundleIdentifier: readString(appshot.bundleIdentifier),
    imageName,
    imageDataUrl,
    imagePath: readString(appshot.imagePath),
    transitionSnapshotDataUrl: readString(appshot.transitionSnapshotDataUrl),
    transitionSnapshotHeight: readPositiveNumber(appshot.transitionSnapshotHeight),
    appIconDataUrl: readString(appshot.appIconDataUrl),
    axTree: readString(appshot.axTree) ?? '',
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
