import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentCredentials, fabricMembership } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { upsertSecret } from '../src/modules/secrets/service'

describe('pending Fabric enrollment routes', () => {
  let dataDir = ''
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
    if (previousCredentialSecret === undefined) {
      delete process.env.CRADLE_CREDENTIAL_SECRET
    }
    else {
      process.env.CRADLE_CREDENTIAL_SECRET = previousCredentialSecret
    }
  })

  async function setup() {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-pending-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'fabric-pending-test-secret'
    return await createServerApp()
  }

  function seedPendingEnrollment(expiresAt?: string): void {
    upsertSecret({ id: 'fabric-identity-pending', kind: 'system-fabric-identity-key', label: 'identity', secret: 'identity-secret' })
    upsertSecret({ id: 'fabric-encryption-pending', kind: 'system-fabric-encryption-key', label: 'encryption', secret: 'encryption-secret' })
    db().insert(fabricMembership).values({
      fabricId: 'fabric-pending',
      relayUrl: 'http://127.0.0.1:8787',
      localNodeId: 'node-pending',
      role: 'pending-node',
      ownerKeySecretId: null,
      identityKeySecretId: 'fabric-identity-pending',
      encryptionKeySecretId: 'fabric-encryption-pending',
      certificateJson: JSON.stringify({
        requestId: 'request-pending',
        deliverySecret: 'delivery-secret',
        ...(expiresAt ? { expiresAt } : {}),
      }),
      createdAt: 100,
      updatedAt: 100,
    }).run()
  }

  it('reads a persisted pending enrollment and cancels its local state', async () => {
    const server = await setup()
    seedPendingEnrollment('2026-08-18T12:00:00.000Z')

    const pending = await server.handle(new Request('http://localhost/fabric/node-invitations/pending'))
    expect(pending.status).toBe(200)
    expect(await pending.json()).toEqual({
      version: 1,
      relayUrl: 'http://127.0.0.1:8787',
      fabricId: 'fabric-pending',
      requestId: 'request-pending',
      deliverySecret: 'delivery-secret',
      expiresAt: '2026-08-18T12:00:00.000Z',
      createdAt: 100,
    })

    const cancelled = await server.handle(new Request('http://localhost/fabric/node-invitations/pending', { method: 'DELETE' }))
    expect(cancelled.status).toBe(204)
    expect(db().select().from(fabricMembership).all()).toEqual([])
    expect(db().select().from(agentCredentials).all()).toEqual([])

    const after = await server.handle(new Request('http://localhost/fabric/node-invitations/pending'))
    expect(await after.json()).toBeNull()
  })

  it('surfaces legacy pending enrollments without a recoverable expiry', async () => {
    const server = await setup()
    seedPendingEnrollment()

    const response = await server.handle(new Request('http://localhost/fabric/node-invitations/pending'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ expiresAt: null })
  })

  it('does not cancel an active Fabric membership', async () => {
    const server = await setup()
    db().insert(fabricMembership).values({
      fabricId: 'fabric-active',
      relayUrl: 'http://127.0.0.1:8787',
      localNodeId: 'node-active',
      role: 'owner',
      ownerKeySecretId: null,
      identityKeySecretId: 'identity-active',
      encryptionKeySecretId: 'encryption-active',
      certificateJson: '{}',
      createdAt: 100,
      updatedAt: 100,
    }).run()

    const response = await server.handle(new Request('http://localhost/fabric/node-invitations/pending', { method: 'DELETE' }))
    expect(response.status).toBe(409)
    expect(db().select().from(fabricMembership).all()).toHaveLength(1)
  })
})
