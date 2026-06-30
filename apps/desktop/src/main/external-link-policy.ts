import type { WebContents } from 'electron'
import { shell } from 'electron'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function resolveUrl(url: string): URL | null {
  try {
    return new URL(url)
  }
  catch {
    return null
  }
}

function isExternalNavigation(url: string, currentUrl: string): boolean {
  const parsed = resolveUrl(url)
  if (!parsed || !EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return false
  }

  if (parsed.protocol === 'mailto:') {
    return true
  }

  const current = resolveUrl(currentUrl)
  return !current || parsed.origin !== current.origin
}

function openExternalUrl(url: string): boolean {
  const parsed = resolveUrl(url)
  if (!parsed || !EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return false
  }

  void shell.openExternal(parsed.toString())
  return true
}

export function installExternalLinkPolicy(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    if (!isExternalNavigation(url, webContents.getURL())) {
      return
    }

    event.preventDefault()
    openExternalUrl(url)
  })
}
