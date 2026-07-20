/**
 * Shared desktop update feed URL helpers.
 *
 * Windows electron-updater reads `latest.yml` from a generic feed root.
 * macOS Sparkle reads an appcast XML feed.
 *
 * `CRADLE_DESKTOP_UPDATE_URL` may be any of:
 * - a feed directory (`…/`, `…/feed`)
 * - a legacy Cradle manifest (`…/manifest.json`)
 * - a Sparkle appcast (`…/appcast.xml`)
 *
 * Optional `CRADLE_DESKTOP_SPARKLE_APPCAST_URL` overrides the macOS appcast.
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
  if (url.endsWith('/manifest.json')) {
    return url.slice(0, -'manifest.json'.length)
  }
  if (url.endsWith('.xml') || url.endsWith('.json') || url.endsWith('.yml') || url.endsWith('.yaml')) {
    return url.slice(0, url.lastIndexOf('/') + 1)
  }
  return url.endsWith('/') ? url : `${url}/`
}

export function resolveSparkleAppcastUrl(updateFeedUrl: string): string {
  const url = updateFeedUrl.trim()
  if (url.endsWith('.xml')) {
    return url
  }
  if (url.endsWith('/manifest.json')) {
    return `${url.slice(0, -'manifest.json'.length)}${DEFAULT_APPCAST_FILE}`
  }
  if (url.endsWith('.json') || url.endsWith('.yml') || url.endsWith('.yaml')) {
    return `${url.slice(0, url.lastIndexOf('/') + 1)}${DEFAULT_APPCAST_FILE}`
  }
  const baseUrl = url.endsWith('/') ? url : `${url}/`
  return new URL(DEFAULT_APPCAST_FILE, baseUrl).toString()
}
