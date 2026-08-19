import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const CODEX_APP_SERVER_PATH_ENV = 'CRADLE_CODEX_APP_SERVER_PATH'
const CODEX_APP_SERVER_PACKAGE_PATH = '@openai/codex/bin/codex.js'

export function resolveManagedCodexAppServerPath(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configuredPath = env[CODEX_APP_SERVER_PATH_ENV]?.trim()
  if (configuredPath) {
    return configuredPath
  }

  try {
    return createRequire(join(rootDir, 'package.json')).resolve(CODEX_APP_SERVER_PACKAGE_PATH)
  }
  catch {
    // Fall through to the desktop-synced native binary when the npm package is absent.
  }

  const platformArch = `${process.platform}-${process.arch}`
  const bundled = join(
    rootDir,
    'apps',
    'desktop',
    'resources',
    'codex',
    platformArch,
    process.platform === 'win32' ? 'codex-app-server.exe' : 'codex-app-server',
  )
  return existsSync(bundled) ? bundled : null
}
