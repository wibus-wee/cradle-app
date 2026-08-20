import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { relayHostEnrollments } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerContractApp } from '../../src/app'
import { CRADLE_RELAY_TOKEN_HEADER } from '../../src/http/auth'
import { db, shutdownInfra } from '../../src/infra'
import { rewriteRelayHttpRequestHead } from '../../src/modules/relay-transport/host-connector'
import { upsertHostRelayAuthToken } from '../../src/modules/relay-transport/relay-auth-token-service'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function createAuthenticatedApp(dataDir: string) {
  process.env.CRADLE_DATA_DIR = dataDir
  process.env.CRADLE_CREDENTIAL_SECRET = 'relay-auth-test-secret'
  process.env.CRADLE_AUTH_REQUIRED = 'true'
  return await createServerContractApp({ includeRuntimeHttpPlugins: true })
}

function insertRelayEnrollment(enrollmentId: string): string {
  const token = upsertHostRelayAuthToken({
    enrollmentId,
    displayName: 'Relay Auth Fixture',
    token: 'relay-auth-token-fixture',
  })
  db().insert(relayHostEnrollments).values({
    id: enrollmentId,
    displayName: 'Relay Auth Fixture',
    relayUrl: 'https://relay.example.test',
    roomId: 'room-relay-auth-fixture',
    hostPubkey: 'host-pubkey-relay-auth-fixture',
    hostPrivateKeySecretId: 'relay-host-key:relay-auth-fixture',
    pinnedControllerPubkey: 'controller-pubkey-relay-auth-fixture',
    status: 'paired',
    pairingCode: null,
    lastError: null,
  }).run()
  return token
}

describe('relay transport auth boundary', () => {
  it('rejects unauthenticated traffic and accepts active relay enrollment tokens', async () => {
    const dataDir = makeTempDir('cradle-relay-auth-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousAuthRequired = process.env.CRADLE_AUTH_REQUIRED

    try {
      const app = await createAuthenticatedApp(dataDir)
      const token = insertRelayEnrollment('relay-auth-fixture')

      const missing = await app.handle(new Request('http://localhost/preferences/app'))
      expect(missing.status).toBe(401)

      const valid = await app.handle(new Request('http://localhost/preferences/app', {
        headers: { [CRADLE_RELAY_TOKEN_HEADER]: token },
      }))
      expect(valid.status).toBe(200)

      db()
        .delete(relayHostEnrollments)
        .where(eq(relayHostEnrollments.id, 'relay-auth-fixture'))
        .run()

      const revoked = await app.handle(new Request('http://localhost/preferences/app', {
        headers: { [CRADLE_RELAY_TOKEN_HEADER]: token },
      }))
      expect(revoked.status).toBe(401)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
      restoreEnv('CRADLE_AUTH_REQUIRED', previousAuthRequired)
    }
  })

  it('injects the relay token into forwarded HTTP request headers', () => {
    const rewritten = rewriteRelayHttpRequestHead([
      'GET /preferences/app HTTP/1.1',
      'Host: 127.0.0.1:21423',
      'Connection: keep-alive',
      `${CRADLE_RELAY_TOKEN_HEADER}: attacker-controlled`,
    ].join('\r\n'), 'trusted-relay-token')

    expect(rewritten).toBe([
      'GET /preferences/app HTTP/1.1',
      'Host: 127.0.0.1:21423',
      `${CRADLE_RELAY_TOKEN_HEADER}: trusted-relay-token`,
      'Connection: close',
    ].join('\r\n'))
  })

  it('preserves HTTP upgrade semantics while injecting the relay token', () => {
    const rewritten = rewriteRelayHttpRequestHead([
      'GET /sync-gateway HTTP/1.1',
      'Host: 127.0.0.1:21423',
      'Connection: Upgrade',
      'Upgrade: websocket',
    ].join('\r\n'), 'trusted-relay-token')

    expect(rewritten).toBe([
      'GET /sync-gateway HTTP/1.1',
      'Host: 127.0.0.1:21423',
      'Upgrade: websocket',
      `${CRADLE_RELAY_TOKEN_HEADER}: trusted-relay-token`,
    ].join('\r\n'))
  })

  it('rejects non-HTTP tunneled stream prefaces', () => {
    expect(rewriteRelayHttpRequestHead('PRI * HTTP/2.0', 'trusted-relay-token')).toBeNull()
  })
})
