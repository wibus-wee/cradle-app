import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getMigrationsPath } from '@cradle/db/paths'
import { z } from 'zod'

const logLevels = ['debug', 'info', 'warn', 'error'] as const

export function isLoopbackBindHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (normalizedHost === 'localhost' || normalizedHost === '::1') {
    return true
  }
  const octets = normalizedHost.split('.')
  return octets.length === 4
    && octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127
}

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
  CRADLE_AUTH_TOKEN: OptionalEnvStringSchema,
  CRADLE_AUTH_REQUIRED: z.enum(['true', 'false']).optional(),
}).transform((env) => {
  const dbPath = env.CRADLE_DB_PATH || (env.CRADLE_DATA_DIR ? join(env.CRADLE_DATA_DIR, 'cradle.db') : undefined)

  if (!dbPath) {
    throw new Error('CRADLE_DATA_DIR or CRADLE_DB_PATH is required')
  }

  const authToken = env.CRADLE_AUTH_TOKEN ?? null
  const authRequired = env.CRADLE_AUTH_TOKEN !== undefined || env.CRADLE_AUTH_REQUIRED === 'true'
  if (!isLoopbackBindHost(env.CRADLE_HOST) && (!authRequired || !authToken)) {
    throw new Error('CRADLE_AUTH_TOKEN is required when CRADLE_HOST is not loopback')
  }

  return {
    host: env.CRADLE_HOST,
    port: env.CRADLE_PORT,
    logLevel: env.CRADLE_LOG_LEVEL,
    dataDir: env.CRADLE_DATA_DIR,
    dbPath,
    migrationsDir: env.CRADLE_MIGRATIONS_DIR || getMigrationsPath(),
    logFile: env.CRADLE_LOG_FILE || (env.CRADLE_DATA_DIR ? join(env.CRADLE_DATA_DIR, 'server.log') : undefined),
    authToken,
    authRequired,
  }
})

const serverAuthEnvSchema = z.object({
  CRADLE_AUTH_TOKEN: OptionalEnvStringSchema,
  CRADLE_AUTH_REQUIRED: z.enum(['true', 'false']).optional(),
}).transform(env => ({
  authToken: env.CRADLE_AUTH_TOKEN ?? null,
  authRequired: env.CRADLE_AUTH_TOKEN !== undefined || env.CRADLE_AUTH_REQUIRED === 'true',
}))

export type LogLevel = (typeof logLevels)[number]

export interface ServerConfigValues {
  host: string
  port: number
  logLevel: LogLevel
  dataDir?: string
  dbPath: string
  migrationsDir: string
  logFile?: string
  authToken: string | null
  authRequired: boolean
}

export type ServerAuthConfigValues = Pick<ServerConfigValues, 'authRequired' | 'authToken'>

export function loadServerAuthConfig(env: NodeJS.ProcessEnv = process.env): ServerAuthConfigValues {
  return serverAuthEnvSchema.parse(env)
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
