import { ClipboardAddon } from '@xterm/addon-clipboard'
import { ImageAddon } from '@xterm/addon-image'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import { ProgressAddon } from '@xterm/addon-progress'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'

const TERMINAL_IMAGE_PIXEL_LIMIT = 1024 * 1024
const TERMINAL_IMAGE_STORAGE_LIMIT_MB = 16

export interface InstalledTerminalAddons {
  searchAddon: SearchAddon
  webglLoaded: boolean
}

/** Install the shared interactive/rendering addons used by every Cradle terminal surface. */
export function installTerminalAddons(terminal: Terminal): InstalledTerminalAddons {
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  terminal.loadAddon(new ClipboardAddon())
  terminal.loadAddon(new ProgressAddon())

  const searchAddon = new SearchAddon()
  terminal.loadAddon(searchAddon)

  let webglLoaded = false
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    terminal.loadAddon(webgl)
    terminal.loadAddon(new ImageAddon({
      pixelLimit: TERMINAL_IMAGE_PIXEL_LIMIT,
      storageLimit: TERMINAL_IMAGE_STORAGE_LIMIT_MB,
    }))
    webglLoaded = true
  }
  catch {
    try {
      terminal.loadAddon(new LigaturesAddon())
    }
    catch { /* The active font or renderer may not support ligatures. */ }
  }

  return { searchAddon, webglLoaded }
}
