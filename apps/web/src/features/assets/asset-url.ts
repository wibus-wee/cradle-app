import { getServerUrl } from '~/lib/electron'

const ASSET_URL_PREFIX = 'cradle-asset://'
const ASSET_DISPLAY_SIZE_MAX = 4096

export interface AssetDisplaySize {
  width: number | null
  height: number | null
}

interface ParsedAssetUrl {
  id: string
  displaySize: AssetDisplaySize
}

export function isCradleAssetUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ASSET_URL_PREFIX) && value.length > ASSET_URL_PREFIX.length
}

export function readAssetIdFromUrl(value: string): string | null {
  return parseAssetUrl(value)?.id ?? null
}

export function readAssetDisplaySizeFromUrl(value: string): AssetDisplaySize | null {
  const parsed = parseAssetUrl(value)
  if (!parsed) {
    return null
  }

  if (!parsed.displaySize.width && !parsed.displaySize.height) {
    return null
  }

  return parsed.displaySize
}

export function toAssetMarkdownUrl(id: string, displaySize?: Partial<AssetDisplaySize> | null): string {
  const params = new URLSearchParams()
  const width = normalizeDisplayDimension(displaySize?.width)
  const height = normalizeDisplayDimension(displaySize?.height)

  if (width) {
    params.set('width', String(width))
  }
  if (height) {
    params.set('height', String(height))
  }

  const query = params.size > 0 ? `?${params.toString()}` : ''
  return `${ASSET_URL_PREFIX}${encodeURIComponent(id)}${query}`
}

export function withAssetDisplaySize(
  markdownUrl: string,
  displaySize: Partial<AssetDisplaySize> | null | undefined,
): string {
  const parsed = parseAssetUrl(markdownUrl)
  if (!parsed) {
    return markdownUrl
  }
  return toAssetMarkdownUrl(parsed.id, displaySize)
}

export function toAssetContentUrl(id: string): string {
  return new URL(`/assets/${encodeURIComponent(id)}/content`, getServerUrl()).toString()
}

function parseAssetUrl(value: string): ParsedAssetUrl | null {
  if (!isCradleAssetUrl(value)) {
    return null
  }

  const suffix = value.slice(ASSET_URL_PREFIX.length)
  const delimiterIndex = suffix.search(/[?#]/)
  const encodedId = delimiterIndex === -1 ? suffix : suffix.slice(0, delimiterIndex)
  if (!encodedId) {
    return null
  }

  try {
    const id = decodeURIComponent(encodedId)
    const params = readAssetUrlParams(delimiterIndex === -1 ? '' : suffix.slice(delimiterIndex))
    return {
      id,
      displaySize: {
        width: normalizeDisplayDimension(params.get('width')),
        height: normalizeDisplayDimension(params.get('height')),
      },
    }
  }
  catch {
    return null
  }
}

function readAssetUrlParams(value: string): URLSearchParams {
  if (!value) {
    return new URLSearchParams()
  }
  if (value.startsWith('?')) {
    const hashIndex = value.indexOf('#')
    return new URLSearchParams(hashIndex === -1 ? value.slice(1) : value.slice(1, hashIndex))
  }
  if (value.startsWith('#')) {
    return new URLSearchParams(value.slice(1))
  }
  return new URLSearchParams()
}

function normalizeDisplayDimension(value: string | number | null | undefined): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return Math.min(ASSET_DISPLAY_SIZE_MAX, Math.max(1, Math.round(numeric)))
}
