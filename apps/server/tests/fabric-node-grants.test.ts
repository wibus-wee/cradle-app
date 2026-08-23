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
import type { MembershipCertificate } from '../src/modules/fabric/protocol'
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
  removedNodes: string[]
  approvedRequestBodies: Array<{
    nodeCertificate?: MembershipCertificate
    controllerCertificate: MembershipCertificate
    grants?: Array<{ grantId: string, fabricId: string, controllerId: string, nodeId: string, scope: string }>
  }>
  rejectedRequests: string[]
}

const pendingIdentity = generateFabricSigningKeyPair()
const pendingEncryption = generateFabricEncryptionKeyPair()
const pendingJoinRequest = {
  requestId: 'join-pending',
  fabricId: 'fabric-1',
  subjectKind: 'node',
  subjectId: 'node-pending',
  identityPubkey: pendingIdentity.publicKeyBase64,
  encryptionPubkey: pendingEncryption.publicKeyBase64,
  displayName: 'Studio Mac',
  platform: 'darwin',
  version: '1.2.3',
  capabilities: ['workspace', 'terminal'],
  deliverySecretHash: 'not-exposed-to-web',
  issuedAt: 1_776_000_000,
  expiresAt: 1_776_000_900,
  signature: 'relay-validated-signature',
}

const pendingControllerRequest = {
  ...pendingJoinRequest,
  requestId: 'join-controller-pending',
  subjectKind: 'controller',
  subjectId: 'controller-ios',
  displayName: 'iPhone',
  platform: 'ios',
  capabilities: ['chat', 'work'],
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
  const server: Server = createServer(async (request, response) => {
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
    if (url.pathname === '/v1/fabrics/fabric-1/join-requests' && request.method === 'GET') {
      writeJson(200, { requests: [pendingJoinRequest, pendingControllerRequest] })
      return
    }
    if (/^\/v1\/join-requests\/[\w-]+\/approve$/u.test(url.pathname) && request.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk))
      }
      state.approvedRequestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        nodeCertificate?: MembershipCertificate
        controllerCertificate: MembershipCertificate
        grants?: Array<{ grantId: string, fabricId: string, controllerId: string, nodeId: string, scope: string }>
      })
      if (url.pathname.includes('controller')) {
        writeJson(200, { fabricId: 'fabric-1', controllerId: 'controller-ios' })
        return
      }
      writeJson(200, { ...offlineNodeSummary, nodeId: 'node-pending', displayName: 'Studio Mac' })
      return
    }
    const rejectRequestMatch = /^\/v1\/fabrics\/fabric-1\/join-requests\/(?<requestId>[\w-]+)$/u.exec(url.pathname)
    if (rejectRequestMatch && request.method === 'DELETE') {
      state.rejectedRequests.push(rejectRequestMatch.groups!.requestId!)
      response.writeHead(204)
      response.end()
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
    const removeNodeMatch = /^\/v1\/nodes\/(?<nodeId>[\w-]+)$/u.exec(url.pathname)
    if (removeNodeMatch && request.method === 'DELETE') {
      state.removedNodes.push(removeNodeMatch.groups!.nodeId!)
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
  const state: FakeDirectoryState = { requests: [], revokedGrants: [], removedNodes: [], approvedRequestBodies: [], rejectedRequests: [] }
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
  const previousRelaydAccessMode = process.env.CRADLE_RELAYD_ACCESS_MODE
  const previousRelaydPid = process.env.CRADLE_RELAYD_PID
  const previousRelaydPublicUrl = process.env.CRADLE_RELAYD_PUBLIC_URL

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
    restoreEnv('CRADLE_RELAYD_ACCESS_MODE', previousRelaydAccessMode)
    restoreEnv('CRADLE_RELAYD_PID', previousRelaydPid)
    restoreEnv('CRADLE_RELAYD_PUBLIC_URL', previousRelaydPublicUrl)
  })

  async function setup(): Promise<ElysiaApp> {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'fabric-node-grants-test-secret'
    state.requests = []
    state.revokedGrants = []
    state.removedNodes = []
    state.approvedRequestBodies = []
    state.rejectedRequests = []
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

  it('projects pending join requests and sends dual certificates for owner decisions', async () => {
    const server = await setup()
    const listed = await server.handle(new Request('http://localhost/fabric/node-invitations/requests'))
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual([{
      requestId: 'join-pending',
      displayName: 'Studio Mac',
      platform: 'darwin',
      version: '1.2.3',
      capabilities: ['workspace', 'terminal'],
      requestedAt: new Date(pendingJoinRequest.issuedAt * 1000).toISOString(),
      expiresAt: new Date(pendingJoinRequest.expiresAt * 1000).toISOString(),
    }])

    const approved = await server.handle(new Request('http://localhost/fabric/node-invitations/requests/join-pending/approve', { method: 'POST' }))
    expect(approved.status).toBe(200)
    expect(state.approvedRequestBodies).toHaveLength(1)
    expect(state.approvedRequestBodies[0]?.nodeCertificate).toMatchObject({ subjectKind: 'node', subjectId: 'node-pending' })
    expect(state.approvedRequestBodies[0]?.controllerCertificate).toMatchObject({
      subjectKind: 'controller',
      subjectId: 'node-pending',
      scopes: ['admin', 'approve', 'control', 'view'],
    })

    const rejected = await server.handle(new Request('http://localhost/fabric/node-invitations/requests/join-pending', { method: 'DELETE' }))
    expect(rejected.status).toBe(204)
    expect(state.rejectedRequests).toEqual(['join-pending'])
  })

  it('approves a Controller for one Node with explicit least-privilege grants', async () => {
    const server = await setup()
    const listed = await server.handle(new Request('http://localhost/fabric/controller-invitations/requests'))
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual([expect.objectContaining({
      requestId: 'join-controller-pending',
      subjectId: 'controller-ios',
      displayName: 'iPhone',
      platform: 'ios',
    })])

    const approved = await server.handle(new Request('http://localhost/fabric/controller-invitations/requests/join-controller-pending/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'node-a', scopes: ['view', 'control', 'approve'] }),
    }))
    expect(approved.status).toBe(200)
    expect(await approved.json()).toEqual({ fabricId: 'fabric-1', controllerId: 'controller-ios' })
    const body = state.approvedRequestBodies[0]!
    expect(body.nodeCertificate).toBeUndefined()
    expect(body.controllerCertificate).toMatchObject({
      subjectKind: 'controller',
      subjectId: 'controller-ios',
      nodeId: 'node-a',
      scopes: ['approve', 'control', 'view'],
    })
    expect(body.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({ controllerId: 'controller-ios', nodeId: 'node-a', scope: 'view' }),
      expect.objectContaining({ controllerId: 'controller-ios', nodeId: 'node-a', scope: 'control' }),
      expect.objectContaining({ controllerId: 'controller-ios', nodeId: 'node-a', scope: 'approve' }),
    ]))
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

  it('permanently removes a remote device through the owner proof', async () => {
    const server = await setup()
    const response = await server.handle(new Request('http://localhost/nodes/node-b', { method: 'DELETE' }))
    expect(response.status).toBe(204)
    expect(state.removedNodes).toEqual(['node-b'])
    expect(state.requests).toContain('DELETE /v1/nodes/node-b')
  })

  it('does not let the owner remove its current local Node', async () => {
    const server = await setup()
    const response = await server.handle(new Request('http://localhost/nodes/node-local', { method: 'DELETE' }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'fabric_local_node_cannot_be_removed' })
    expect(state.removedNodes).toEqual([])
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

  it('exposes an external Relay endpoint when Desktop is configured to use one', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_RELAYD_PUBLIC_URL = 'https://relay.example.com'
    process.env.CRADLE_RELAYD_ACCESS_MODE = 'external'
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/fabric/managed-relay'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      relayUrl: 'https://relay.example.com',
      accessMode: 'external',
    })
  })

  it('does not include an external Relay in local process resources', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_RELAYD_ACCESS_MODE = 'external'
    process.env.CRADLE_RELAYD_PID = String(process.pid)
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/fabric/managed-relay/resources'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      source: 'external',
      running: false,
      pid: null,
      rssMB: null,
      cpuPercent: null,
      descendantCount: null,
    })
  })

  it('reports the managed Relay process tree resources', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_RELAYD_ACCESS_MODE = 'network'
    process.env.CRADLE_RELAYD_PID = String(process.pid)
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/fabric/managed-relay/resources'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      source: 'managed',
      running: true,
      pid: process.pid,
      rssMB: expect.any(Number),
      cpuPercent: expect.any(Number),
      descendantCount: expect.any(Number),
    })
  })

  it('reports unavailable resources when Desktop did not provide a managed Relay PID', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-fabric-grants-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_RELAYD_ACCESS_MODE = 'local'
    delete process.env.CRADLE_RELAYD_PID
    const server = await createServerApp()
    const response = await server.handle(new Request('http://localhost/fabric/managed-relay/resources'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ source: 'unavailable', running: false, pid: null })
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
