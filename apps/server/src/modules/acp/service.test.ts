import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acpAuditLog } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { createRemoteAgent } from './service'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) { delete process.env[name] }
  else { process.env[name] = previousValue }
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-acp-remote-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  try {
    return await callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  }
}

afterEach(() => shutdownInfra())

describe('remote ACP agent configuration', () => {
  it.each([
    ['http', 'https://agent.example.com/acp'],
    ['websocket', 'wss://agent.example.com/acp'],
    ['http', 'http://127.0.0.1:8080/acp'],
    ['websocket', 'ws://localhost:8080/acp'],
  ] as const)('accepts %s endpoint %s', async (connectionType, endpointUrl) => {
    await withTempDataDir(() => {
      const agent = createRemoteAgent({
        id: `remote-${connectionType}-${endpointUrl.includes('localhost') || endpointUrl.includes('127.') ? 'local' : 'tls'}`,
        name: 'Remote agent',
        connectionType,
        endpointUrl,
      }, new Set())

      expect(agent).toMatchObject({ source: 'remote', connectionType })
      expect(agent.endpointUrl).toBe(new URL(endpointUrl).toString())
    })
  })

  it.each([
    ['http', 'http://agent.example.com/acp'],
    ['websocket', 'ws://agent.example.com/acp'],
    ['http', 'wss://agent.example.com/acp'],
    ['websocket', 'https://agent.example.com/acp'],
  ] as const)('rejects insecure or mismatched %s endpoint %s', async (connectionType, endpointUrl) => {
    await withTempDataDir(() => {
      expect(() => createRemoteAgent({ name: 'Remote agent', connectionType, endpointUrl }, new Set()))
        .toThrow()
    })
  })

  it('rejects transport-owned headers and missing Secret references', async () => {
    await withTempDataDir(() => {
      expect(() => createRemoteAgent({
        name: 'Reserved header',
        connectionType: 'http',
        endpointUrl: 'https://agent.example.com/acp',
        headerSecretRefs: { Cookie: 'secret-token' },
      }, new Set(['secret-token']))).toThrow(/transport owns/i)

      expect(() => createRemoteAgent({
        name: 'Missing secret',
        connectionType: 'http',
        endpointUrl: 'https://agent.example.com/acp',
        headerSecretRefs: { Authorization: 'missing-secret' },
      }, new Set())).toThrow(/existing Secrets/i)
    })
  })

  it('persists transport header Secret references independently from ACP auth', async () => {
    await withTempDataDir(() => {
      const agent = createRemoteAgent({
        id: 'remote-headers',
        name: 'Remote headers',
        connectionType: 'http',
        endpointUrl: 'https://agent.example.com/acp',
        headerSecretRefs: { Authorization: 'secret-token' },
      }, new Set(['secret-token']))

      expect(agent.remoteHeadersSecretRefs).toEqual({ Authorization: 'secret-token' })
    })
  })

  it('audits header names without Secret references or credential values', async () => {
    await withTempDataDir(() => {
      createRemoteAgent({
        id: 'remote-audit',
        name: 'Audit agent',
        connectionType: 'http',
        endpointUrl: 'https://agent.example.com/acp?token=not-a-credential-field',
        headerSecretRefs: { Authorization: 'secret-token' },
      }, new Set(['secret-token']))

      const audit = db().select().from(acpAuditLog).get()
      expect(audit).toBeDefined()
      expect(JSON.parse(audit!.details)).toMatchObject({
        endpointOrigin: 'https://agent.example.com',
        headerNames: ['Authorization'],
      })
      expect(audit!.details).not.toContain('secret-token')
      expect(audit!.details).not.toContain('not-a-credential-field')
    })
  })
})
