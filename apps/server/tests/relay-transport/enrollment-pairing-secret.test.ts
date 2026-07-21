import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { relayHostEnrollments } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerContractApp } from '../../src/app'
import { db, shutdownInfra } from '../../src/infra'
import { generateRelayKeyPair, relayPublicKeyFingerprint } from '../../src/modules/relay-transport/crypto'
import { upsertHostRelayAuthToken } from '../../src/modules/relay-transport/relay-auth-token-service'
import { readSecret, removeSecret, upsertSecret } from '../../src/modules/secrets/service'

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

describe('relay host enrollment pairing secret surface', () => {
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
  const previousAuthRequired = process.env.CRADLE_AUTH_REQUIRED
  let dataDir: string

  beforeEach(() => {
    dataDir = makeTempDir('cradle-relay-pairing-')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'relay-pairing-test-secret'
    process.env.CRADLE_AUTH_REQUIRED = 'false'
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    restoreEnv('CRADLE_AUTH_REQUIRED', previousAuthRequired)
    vi.restoreAllMocks()
  })

  it('list/get omit pairingCode; pairing-string is the only re-read path', async () => {
    const app = await createServerContractApp({ includeRuntimeHttpPlugins: true })
    const keys = generateRelayKeyPair()
    const enrollmentId = 'enroll-pairing-secret'
    const pairingCode = 'PAIR-SECRET-1'
    const now = Math.floor(Date.now() / 1000)

    upsertSecret({
      id: `relay-host-key:${enrollmentId}`,
      kind: 'system-relay-host-key',
      label: 'test host key',
      secret: keys.privateKeyBase64,
    })
    upsertHostRelayAuthToken({ enrollmentId, displayName: 'Test host' })

    db().insert(relayHostEnrollments).values({
      id: enrollmentId,
      displayName: 'Test host',
      relayUrl: 'https://relay.example.test',
      roomId: 'room-pairing-secret',
      hostPubkey: keys.publicKeyBase64,
      hostPrivateKeySecretId: `relay-host-key:${enrollmentId}`,
      pinnedControllerPubkey: null,
      status: 'pending',
      pairingCode,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }).run()

    const list = await app.handle(new Request('http://localhost/relay-transport/host-enrollments'))
    expect(list.status).toBe(200)
    const listed = await list.json() as Array<Record<string, unknown>>
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('pairingCode')
    expect(listed[0].pairable).toBe(true)

    const get = await app.handle(new Request(`http://localhost/relay-transport/host-enrollments/${enrollmentId}`))
    expect(get.status).toBe(200)
    const one = await get.json() as Record<string, unknown>
    expect(one).not.toHaveProperty('pairingCode')
    expect(one.pairable).toBe(true)

    const pairing = await app.handle(new Request(`http://localhost/relay-transport/host-enrollments/${enrollmentId}/pairing-string`))
    expect(pairing.status).toBe(200)
    const pairingBody = await pairing.json() as { pairingString: string, pairingCode: string, hostKeyFingerprint: string }
    expect(pairingBody.pairingCode).toBe(pairingCode)
    expect(pairingBody.pairingString).toBe(
      `${pairingCode}:room-pairing-secret#${relayPublicKeyFingerprint(keys.publicKeyBase64)}`,
    )
  })

  it('delete enrollment revokes the relay auth token secret', async () => {
    const app = await createServerContractApp({ includeRuntimeHttpPlugins: true })
    const keys = generateRelayKeyPair()
    const enrollmentId = 'enroll-delete-revoke'
    const now = Math.floor(Date.now() / 1000)
    const token = upsertHostRelayAuthToken({
      enrollmentId,
      displayName: 'Delete me',
      token: 'relay-token-to-revoke',
    })
    upsertSecret({
      id: `relay-host-key:${enrollmentId}`,
      kind: 'system-relay-host-key',
      label: 'test host key',
      secret: keys.privateKeyBase64,
    })
    db().insert(relayHostEnrollments).values({
      id: enrollmentId,
      displayName: 'Delete me',
      relayUrl: 'https://relay.example.test',
      roomId: 'room-delete-revoke',
      hostPubkey: keys.publicKeyBase64,
      hostPrivateKeySecretId: `relay-host-key:${enrollmentId}`,
      pinnedControllerPubkey: null,
      status: 'pending',
      pairingCode: 'PAIR-DEL',
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }).run()

    expect(readSecret(`relay-host-auth-token:${enrollmentId}`)).toBe(token)

    const del = await app.handle(new Request(`http://localhost/relay-transport/host-enrollments/${enrollmentId}`, {
      method: 'DELETE',
    }))
    expect(del.status).toBe(200)

    expect(
      db().select().from(relayHostEnrollments).where(eq(relayHostEnrollments.id, enrollmentId)).get(),
    ).toBeUndefined()

    expect(() => readSecret(`relay-host-auth-token:${enrollmentId}`)).toThrow()
    expect(() => readSecret(`relay-host-key:${enrollmentId}`)).toThrow()

    // Idempotent cleanup path used by production delete.
    removeSecret(`relay-host-auth-token:${enrollmentId}`)
  })
})
