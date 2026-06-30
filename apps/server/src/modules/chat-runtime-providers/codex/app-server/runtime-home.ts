import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function resolveCodexAppServerHome(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtimes', 'codex-app-server')
  }

  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return join(dirname(dbPath), 'runtimes', 'codex-app-server')
  }

  return join(input.homeDir ?? homedir(), '.cradle', 'runtimes', 'codex-app-server')
}

export function prepareCodexAppServerHome(): string {
  const resolvedHome = resolveCodexAppServerHome()
  mkdirSync(resolvedHome, { recursive: true })
  return resolvedHome
}
