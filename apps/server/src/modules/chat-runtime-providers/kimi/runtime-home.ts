import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export function resolveKimiRuntimeHome(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtimes', 'kimi')
  }

  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return join(dirname(dbPath), 'runtimes', 'kimi')
  }

  return join(input.homeDir ?? homedir(), '.cradle', 'runtimes', 'kimi')
}

export function resolveKimiProviderHome(providerTargetId: string): string {
  if (!providerTargetId.trim()) {
    throw new Error('Kimi provider target id is required.')
  }
  const root = resolveKimiRuntimeHome()
  const home = resolve(root, 'providers', encodeURIComponent(providerTargetId))
  const relativeHome = relative(root, home)
  if (relativeHome.startsWith('..') || relativeHome === '' || isAbsolute(relativeHome)) {
    throw new Error('Kimi provider home escaped the Cradle runtime directory.')
  }
  return home
}

export function prepareKimiProviderHome(providerTargetId: string): string {
  const home = resolveKimiProviderHome(providerTargetId)
  mkdirSync(home, { recursive: true, mode: 0o700 })
  return home
}
