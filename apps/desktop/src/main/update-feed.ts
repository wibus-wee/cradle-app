/**
 * Shared desktop update feed URL helpers.
 *
 * Windows electron-updater reads `latest.yml` from a generic feed root.
 * macOS Sparkle reads an appcast XML feed.
 *
 * `CRADLE_DESKTOP_UPDATE_URL` is the shared feed directory. Optional
 * `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` overrides its macOS appcast.
 */

declare const __CRADLE_DESKTOP_UPDATE_URL__: string
declare const __CRADLE_DESKTOP_SPARKLE_APPCAST_URL__: string
declare const __CRADLE_SPARKLE_ED_PUBLIC_KEY__: string

const DEFAULT_APPCAST_FILE = 'appcast.xml'

export function readUpdateFeedUrl(): string | null {
  const url = (process.env.CRADLE_DESKTOP_UPDATE_URL ?? __CRADLE_DESKTOP_UPDATE_URL__).trim()
  return url || null
}

export function readSparkleAppcastUrl(updateFeedUrl: string | null = readUpdateFeedUrl()): string | null {
  const explicit = (process.env.CRADLE_DESKTOP_SPARKLE_APPCAST_URL ?? __CRADLE_DESKTOP_SPARKLE_APPCAST_URL__).trim()
  if (explicit) {
    return explicit
  }
  if (!updateFeedUrl) {
    return null
  }
  return resolveSparkleAppcastUrl(updateFeedUrl)
}

export function readSparklePublicEdKey(): string | null {
  const key = (process.env.SPARKLE_ED_PUBLIC_KEY ?? __CRADLE_SPARKLE_ED_PUBLIC_KEY__).trim()
  return key || null
}

export function resolveElectronUpdaterFeedUrl(updateFeedUrl: string): string {
  const url = updateFeedUrl.trim()
  if (url.endsWith('/appcast.xml')) {
    return url.slice(0, -'appcast.xml'.length)
  }
  return url.endsWith('/') ? url : `${url}/`
}

export function resolveSparkleAppcastUrl(updateFeedUrl: string): string {
  const url = updateFeedUrl.trim()
  if (url.endsWith('.xml')) {
    return url
  }
  const baseUrl = url.endsWith('/') ? url : `${url}/`
  return new URL(DEFAULT_APPCAST_FILE, baseUrl).toString()
}
