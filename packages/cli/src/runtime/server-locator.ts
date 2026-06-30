import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:21423'
const ServerLocatorSchema = z.object({
  serverUrl: z.string().url(),
  pid: z.number().int().positive().nullable().optional(),
  version: z.string().optional(),
  updatedAt: z.string().optional(),
})

function readDesktopUserDataDir(): string {
  const envPath = process.env.CRADLE_DESKTOP_USER_DATA_DIR?.trim()
  if (envPath) {
    return envPath
  }

  const home = homedir()
  const currentPlatform = platform()
  if (currentPlatform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Cradle')
  }
  if (currentPlatform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Cradle')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Cradle')
}

function readDesktopLocatorServerUrl(): string | null {
  const locatorPath = join(readDesktopUserDataDir(), 'cli', 'server.json')
  if (!existsSync(locatorPath)) {
    return null
  }

  try {
    const locator = ServerLocatorSchema.parse(JSON.parse(readFileSync(locatorPath, 'utf8')))
    return locator.serverUrl
  }
  catch {
    return null
  }
}

export function resolveServerUrl(input: { explicitServerUrl?: string | null } = {}): string {
  return input.explicitServerUrl?.trim()
    || process.env.CRADLE_SERVER_URL?.trim()
    || readDesktopLocatorServerUrl()
    || DEFAULT_SERVER_URL
}
