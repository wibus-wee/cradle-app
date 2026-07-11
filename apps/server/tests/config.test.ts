import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isLoopbackBindHost, loadServerConfig } from '../src/config/server-config'

describe('server config', () => {
  it('parses defaults and derives dbPath from data dir', () => {
    const cfg = loadServerConfig({ CRADLE_DATA_DIR: '/tmp/cradle-data' })
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(21423)
    expect(cfg.dbPath).toBe('/tmp/cradle-data/cradle.db')
    expect(cfg.migrationsDir).toContain('drizzle')
  })

  it('throws when no db path provided', () => {
    expect(() => loadServerConfig({})).toThrow(/CRADLE_DATA_DIR or CRADLE_DB_PATH/)
  })

  it('prefers CRADLE_DB_PATH over data dir and ensures parent directory exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-config-'))
    const dbPath = join(root, 'nested', 'cradle.db')

    try {
      expect(existsSync(join(root, 'nested'))).toBe(false)
      const cfg = loadServerConfig({
        CRADLE_DATA_DIR: '/tmp/should-ignore',
        CRADLE_DB_PATH: dbPath,
      })

      expect(cfg.dbPath).toBe(dbPath)
      expect(existsSync(join(root, 'nested'))).toBe(true)
    }
 finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('treats empty strings as missing and trims whitespace', () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-data-'))

    try {
      const cfg = loadServerConfig({
        CRADLE_DATA_DIR: `   ${root}   `,
        CRADLE_DB_PATH: '   ',
        CRADLE_MIGRATIONS_DIR: `   ${join(root, 'drizzle')}   `,
      })

      expect(cfg.dataDir).toBe(root)
      expect(cfg.dbPath).toBe(join(root, 'cradle.db'))
      expect(cfg.migrationsDir).toBe(join(root, 'drizzle'))
      expect(() => loadServerConfig({ CRADLE_DATA_DIR: '  ', CRADLE_DB_PATH: '' })).toThrow(
        /CRADLE_DATA_DIR or CRADLE_DB_PATH/,
      )
    }
 finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['localhost', '127.0.0.1', '127.42.0.8', '::1', '[::1]'])(
    'allows the loopback bind host %s without authentication',
    (host) => {
      expect(isLoopbackBindHost(host)).toBe(true)
      expect(loadServerConfig({ CRADLE_DATA_DIR: '/tmp/cradle-data', CRADLE_HOST: host }).authRequired).toBe(false)
    },
  )

  it.each(['0.0.0.0', '::', '192.168.1.20', 'cradle.internal'])(
    'requires a configured token for the non-loopback bind host %s',
    (host) => {
      expect(isLoopbackBindHost(host)).toBe(false)
      expect(() => loadServerConfig({
        CRADLE_DATA_DIR: '/tmp/cradle-data',
        CRADLE_HOST: host,
      })).toThrow(/CRADLE_AUTH_TOKEN is required/)
      expect(loadServerConfig({
        CRADLE_AUTH_TOKEN: 'network-token',
        CRADLE_DATA_DIR: '/tmp/cradle-data',
        CRADLE_HOST: host,
      }).authRequired).toBe(true)
    },
  )
})
