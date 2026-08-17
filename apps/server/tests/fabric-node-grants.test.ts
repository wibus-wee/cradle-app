import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fabricMembership } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import {
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  signFabricCertificate,
} from '../src/modules/fabric/protocol'
import { upsertSecret } from '../src/modules/secrets/service'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

interface FakeDirectoryState {
  requests: string[]
  revokedGrants: string[]
}

const nodeASummary = {
  nodeId: 'node-a',
  fabricId: 'fabric-1',
  displayName: 'MacBook Pro',
  platform: 'darwin',
  version: '1.0.0',
  capabilities: ['workspace', 'terminal'],
  status: 'online',
  lastSeenAt: '2026-08-16T12:00:00.000Z',
  revision: 3,
  scopes: ['view', 'control'],
}

const offlineNodeSummary = {
  ...nodeASummary,
  nodeId: 'node-b',
  displayName: 'Headless Devbox',
  status: 'offline',
  scopes: ['view'],
}

const nodeAGrants = [
  { grantId: 'grant-1', fabricId: 'fabric-1', controllerId: 'controller-a', nodeId: 'node-a', scope: 'view' },
  { grantId: 'grant-2', fabricId: 'fabric-1', controllerId: 'controller-b', nodeId: 'node-a', scope: 'control', revokedAt: '2026-08-16T13:00:00.000Z' },
]

function startFakeDirectory(state: FakeDirectoryState): Promise<{ baseUrl: string, close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    state.requests.push(`${request.method ?? 'GET'} ${url.pathname}`)
    const writeJson = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (url.pathname === '/v1/fabrics/fabric-1/nodes' && request.method === 'GET') {
      writeJson(200, { revision: 3, nodes: [nodeASummary, offlineNodeSummary] })
      return
    }
    if (url.pathname === '/v1/nodes/node-a/grants' && request.method === 'GET') {
      writeJson(200, { grants: nodeAGrants })
      return
    }
    const revokeMatch = /^\/v1\/nodes\/node-a\/grants\/(?<grantId>[\w-]+)$/u.exec(url.pathname)
    if (revokeMatch && request.method === 'DELETE') {
      state.revokedGrants.push(revokeMatch.groups!.grantId!)
      response.writeHead(204)
      response.end()
      return
    }
    writeJson(404, { error: 'not found' })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(done => server.close(() => done())),
      })
    })
  })
}

function seedFabricMembership(relayUrl: string): void {
  const owner = generateFabricSigningKeyPair()
  const identity = generateFabricSigningKeyPair()
  const encryption = generateFabricEncryptionKeyPair()
  const nodeCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: 'fabric-1',
    subjectKind: 'node',
    subjectId: 'node-local',
    identityPubkey: identity.publicKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64,
    scopes: ['admin'],
  })
  const controllerCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: 'fabric-1',
    subjectKind: 'controller',
    subjectId: 'node-local',
    identityPubkey: identity.publicKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64,
    scopes: ['admin', 'approve', 'control', 'view'],
  })
  upsertSecret({ id: 'fabric-owner-test', kind: 'system-fabric-owner-key', label: 'owner', secret: owner.privateKeyBase64 })
  upsertSecret({ id: 'fabric-identity-test', kind: 'system-fabric-identity-key', label: 'identity', secret: identity.privateKeyBase64 })
  upsertSecret({ id: 'fabric-encryption-test', kind: 'system-fabric-encryption-key', label: 'encryption', secret: encryption.privateKeyBase64 })
  db().insert(fabricMembership).values({
    fabricId: 'fabric-1',
    relayUrl,
    localNodeId: 'node-local',
    role: 'owner',
    ownerKeySecretId: 'fabric-owner-test',
    identityKeySecretId: 'fabric-identity-test',
    encryptionKeySecretId: 'fabric-encryption-test',
    certificateJson: JSON.stringify({ node: nodeCertificate, controller: controllerCertificate }),
    createdAt: 1,
    updatedAt: 1,
  }).run()
}

describe('fabric node directory routes', () => {
  let dataDir = ''
  let directory: { baseUrl: string, close: () => Promise<void> } | undefined
  const state: FakeDirectoryState = { requests: [], revokedGrants: [] }
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET

  afterEach(async () => {
    shutdownInfra()
    await directory?.close()
    directory = undefined
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

  async function setup(): Promise<ElysiaApp> {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'fabric-node-grants-test-secret'
    state.requests = []
    state.revokedGrants = []
    directory = await startFakeDirectory(state)
    const created = await createServerApp()
    seedFabricMembership(directory.baseUrl)
    return created
  }

  it('gets the last-known node summary, including offline Nodes and caller scopes', async () => {
    const server = await setup()
    const online = await server.handle(new Request('http://localhost/nodes/node-a'))
    expect(online.status).toBe(200)
    expect(await online.json()).toEqual(nodeASummary)

    const offline = await server.handle(new Request('http://localhost/nodes/node-b'))
    expect(offline.status).toBe(200)
    const offlineBody = await offline.json()
    expect(offlineBody.status).toBe('offline')
    expect(offlineBody.scopes).toEqual(['view'])
  })

  it('rejects Nodes outside the caller grant filter', async () => {
    const server = await setup()
    const response = await server.handle(new Request('http://localhost/nodes/node-unknown'))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('fabric_node_not_found')
  })

  it('lists active and revoked grants through the owner proof', async () => {
    const server = await setup()
    const response = await server.handle(new Request('http://localhost/nodes/node-a/grants'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(nodeAGrants)
    expect(state.requests).toContain('GET /v1/nodes/node-a/grants')
  })

  it('revokes the grant at the relay directory', async () => {
    const server = await setup()
    const response = await server.handle(new Request('http://localhost/nodes/node-a/grants/grant-1', { method: 'DELETE' }))
    expect(response.status).toBe(204)
    expect(state.revokedGrants).toEqual(['grant-1'])
  })

  it('grant routes require a Fabric membership', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/nodes/node-a/grants'))
    expect(response.status).toBe(409)
  })

  it('returns JSON null before this Server joins a Fabric', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/fabric'))
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it('exposes the Desktop-managed Relay endpoint', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_RELAYD_PUBLIC_URL = 'http://192.168.1.20:8787'
    process.env.CRADLE_RELAYD_ACCESS_MODE = 'network'
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/fabric/managed-relay'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      relayUrl: 'http://192.168.1.20:8787',
      accessMode: 'network',
    })
  })
})
