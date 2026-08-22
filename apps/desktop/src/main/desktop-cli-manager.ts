import { macDesktopCliCommand } from './desktop-cli-command-mac'
import { windowsDesktopCliCommand } from './desktop-cli-command-windows'

export interface DesktopCliStatus {
  supported: boolean
  installed: boolean
  linked: boolean
  requiresRepair: boolean
  commandPath: string
  sourcePath: string | null
  errorMessage: string | null
}

/**
 * Per-platform owner of the packaged CLI command lifecycle (install, repair,
 * remove) exposed as a PATH command. macOS links the bundled launcher into
 * /usr/local/bin; Windows writes a shim into a Cradle-owned directory and
 * appends it to the user PATH in the registry.
 */
export interface DesktopCliCommandPlatform {
  commandPath: string
  readStatus: () => Promise<DesktopCliStatus>
  install: () => Promise<DesktopCliStatus>
  remove: () => Promise<DesktopCliStatus>
}

export function readUnsupportedDesktopCliStatus(
  commandPath: string,
  errorMessage: string,
): DesktopCliStatus {
  return {
    supported: false,
    installed: false,
    linked: false,
    requiresRepair: false,
    commandPath,
    sourcePath: null,
    errorMessage,
  }
}

function selectPlatformCommand(): DesktopCliCommandPlatform | null {
  if (process.platform === 'darwin') {
    return macDesktopCliCommand
  }
  if (process.platform === 'win32') {
    return windowsDesktopCliCommand
  }
  return null
}

function readUnsupportedPlatformStatus(): DesktopCliStatus {
  return readUnsupportedDesktopCliStatus(
    'cradle',
    'CLI PATH installation is currently available on macOS and Windows.',
  )
}

export async function readDesktopCliStatus(): Promise<DesktopCliStatus> {
  const platform = selectPlatformCommand()
  if (!platform) {
    return readUnsupportedPlatformStatus()
  }
  return platform.readStatus()
}

export async function installDesktopCliCommand(): Promise<DesktopCliStatus> {
  const platform = selectPlatformCommand()
  if (!platform) {
    return readUnsupportedPlatformStatus()
  }
  return platform.install()
}

export async function removeDesktopCliCommand(): Promise<DesktopCliStatus> {
  const platform = selectPlatformCommand()
  if (!platform) {
    return readUnsupportedPlatformStatus()
  }
  return platform.remove()
}
