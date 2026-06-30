import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getMigrationsPath } from '@cradle/db/paths'
import { z } from 'zod'

const logLevels = ['debug', 'info', 'warn', 'error'] as const

const OptionalEnvStringSchema = z.string()
  .trim()
  .transform(value => value.length > 0 ? value : undefined)
  .optional()

const serverEnvSchema = z.object({
  CRADLE_HOST: z.string().default('127.0.0.1'),
  CRADLE_PORT: z.coerce.number().int().positive().default(21423),
  CRADLE_LOG_LEVEL: z.enum(logLevels).default('info'),
  CRADLE_DATA_DIR: OptionalEnvStringSchema,
  CRADLE_DB_PATH: OptionalEnvStringSchema,
  CRADLE_MIGRATIONS_DIR: OptionalEnvStringSchema,
  CRADLE_LOG_FILE: OptionalEnvStringSchema,
}).transform((env) => {
  const dbPath = env.CRADLE_DB_PATH || (env.CRADLE_DATA_DIR ? join(env.CRADLE_DATA_DIR, 'cradle.db') : undefined)

  if (!dbPath) {
    throw new Error('CRADLE_DATA_DIR or CRADLE_DB_PATH is required')
  }

  return {
    host: env.CRADLE_HOST,
    port: env.CRADLE_PORT,
    logLevel: env.CRADLE_LOG_LEVEL,
    dataDir: env.CRADLE_DATA_DIR,
    dbPath,
    migrationsDir: env.CRADLE_MIGRATIONS_DIR || getMigrationsPath(),
    logFile: env.CRADLE_LOG_FILE || (env.CRADLE_DATA_DIR ? join(env.CRADLE_DATA_DIR, 'server.log') : undefined),
  }
})

export type LogLevel = (typeof logLevels)[number]

export interface ServerConfigValues {
  host: string
  port: number
  logLevel: LogLevel
  dataDir?: string
  dbPath: string
  migrationsDir: string
  logFile?: string
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfigValues {
  const config = serverEnvSchema.parse(env)
  mkdirSync(dirname(config.dbPath), { recursive: true })
  return config
}

export class ServerConfig {
  private readonly config = loadServerConfig()

  get(): ServerConfigValues {
    return this.config
  }
}
