import { mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

const fabricNodeLinkTestState = vi.hoisted(() => ({ baseUrl: null as string | null }))

vi.mock('../src/modules/relay-transport/node-link-manager', () => ({
  getFabricNodeLinkManager: () => ({
    ensure: async () => {
      if (!fabricNodeLinkTestState.baseUrl) {
        throw new Error('fake Fabric Node link has not been configured')
      }
      return { localBaseUrl: fabricNodeLinkTestState.baseUrl }
    },
  }),
}))

interface FakeRemoteWorkspaceState {
  forwardedRequests: Array<{ method: string, path: string, body: FakeRemoteRequestBody | null }>
  workspacePath: string
}

interface FakeRemoteRequestBody {
  path?: string
  sourcePath?: string
  destinationPath?: string
  content?: string
  confirmedNonCradleOwnedWrite?: boolean
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function remoteWorkspace(state: FakeRemoteWorkspaceState) {
  return {
    id: 'remote-workspace-1',
    name: 'Remote Project',
    locator: { nodeId: 'local', path: state.workspacePath },
    gitIdentity: { repoRoot: state.workspacePath },
    identifier: 'REM',
    pinned: 0,
    createdAt: 1,
    updatedAt: 2,
  }
}

function writeJson(response: ServerResponse, payload: object | object[] | null): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request: IncomingMessage): Promise<FakeRemoteRequestBody> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as FakeRemoteRequestBody
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function startFakeRemoteCradleServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
  state: FakeRemoteWorkspaceState
}> {
  const state: FakeRemoteWorkspaceState = {
    forwardedRequests: [],
    workspacePath: '/remote/project',
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const method = request.method ?? 'GET'
      const body = method === 'GET' ? null : await readJsonBody(request)
      state.forwardedRequests.push({ method, path: `${url.pathname}${url.search}`, body })

      if (url.pathname === '/workspaces') {
        writeJson(response, [remoteWorkspace(state)])
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1' && method === 'GET') {
        writeJson(response, remoteWorkspace(state))
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1/files/search') {
        writeJson(response, [{ type: 'file', name: 'main.ts', path: 'src/main.ts' }])
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1/files/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        })
        response.end(
          'data: {"type":"directory-changed","workspaceId":"remote-workspace-1","path":"src","timestamp":1}\n\n',
        )
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1/files/raw') {
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
        })
        response.end(Buffer.from([0, 1, 2, 255]))
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1/files/rendition/pdf') {
        response.writeHead(200, {
          'content-type': 'application/pdf',
          'x-cradle-rendition-source': 'converted',
        })
        response.end('%PDF-remote')
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1/location' && method === 'PATCH') {
        state.workspacePath = String(body?.path)
        writeJson(response, remoteWorkspace(state))
        return
      }
      if (url.pathname === '/workspaces/remote-workspace-1/files/path' && method === 'PATCH') {
        writeJson(response, {
          success: true,
          sourceBoundary: ownerBoundary(state.workspacePath, String(body?.sourcePath)),
          destinationBoundary: ownerBoundary(state.workspacePath, String(body?.destinationPath)),
        })
        return
      }
      if (
        (url.pathname === '/workspaces/remote-workspace-1/files/content' && method === 'PUT')
        || (url.pathname === '/workspaces/remote-workspace-1/files/file' && method === 'POST')
        || (url.pathname === '/workspaces/remote-workspace-1/files/folder' && method === 'POST')
      ) {
        writeJson(response, {
          success: true,
          ownerBoundary: ownerBoundary(state.workspacePath, String(body?.path)),
        })
        return
      }

      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 'not_found', message: 'not found' }))
    })().catch((error) => {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end(error instanceof Error ? error.message : String(error))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  fabricNodeLinkTestState.baseUrl = baseUrl
  return { baseUrl, state, close: () => closeServer(server) }
}

function ownerBoundary(workspacePath: string, relativePath: string) {
  return {
    classification: 'non-cradle-owned',
    owner: 'workspace',
    consentRequired: true,
    consentConfirmed: true,
    workspacePath,
    relativePath,
    targetPath: `${workspacePath}/${relativePath}`,
  }
}

describe('remote workspace parity', () => {
  let remoteServer: Awaited<ReturnType<typeof startFakeRemoteCradleServer>> | null = null

  afterEach(async () => {
    await remoteServer?.close()
    remoteServer = null
    fabricNodeLinkTestState.baseUrl = null
    shutdownInfra()
  })

  it('forwards file reads, events, writes, and relink to the owning Node', async () => {
    const dataDir = makeTempDir('cradle-remote-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      remoteServer = await startFakeRemoteCradleServer()
      const app = await createServerApp()
      const createResponse = await app.handle(
        new Request('http://localhost/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Remote Project',
            locator: {
              nodeId: 'node-studio',
              path: '/remote/project',
              sourceWorkspaceId: 'remote-workspace-1',
            },
          }),
        }),
      )
      const workspace = (await createResponse.json()) as { id: string }
      const workspaceUrl = `http://localhost/workspaces/${workspace.id}`

      const searchResponse = await app.handle(
        new Request(`${workspaceUrl}/files/search?q=main&limit=5`),
      )
      expect(await searchResponse.json()).toEqual([
        { type: 'file', name: 'main.ts', path: 'src/main.ts' },
      ])

      const eventsResponse = await app.handle(new Request(`${workspaceUrl}/files/events`))
      expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream')
      expect(await eventsResponse.text()).toContain('"type":"directory-changed"')

      const rawResponse = await app.handle(new Request(`${workspaceUrl}/files/raw?path=asset.bin`))
      expect(rawResponse.headers.get('content-type')).toBe('application/octet-stream')
      expect([...new Uint8Array(await rawResponse.arrayBuffer())]).toEqual([0, 1, 2, 255])

      const pdfResponse = await app.handle(
        new Request(`${workspaceUrl}/files/rendition/pdf?path=report.docx`),
      )
      expect(pdfResponse.headers.get('x-cradle-rendition-source')).toBe('converted')
      expect(await pdfResponse.text()).toBe('%PDF-remote')

      const writeResponse = await app.handle(
        jsonRequest(`${workspaceUrl}/files/content`, 'PUT', {
          path: 'notes.md',
          content: 'remote text',
          confirmedNonCradleOwnedWrite: true,
        }),
      )
      expect(await writeResponse.json()).toEqual(
        expect.objectContaining({
          success: true,
          ownerBoundary: expect.objectContaining({
            workspacePath: '/remote/project',
            relativePath: 'notes.md',
          }),
        }),
      )

      const createFileResponse = await app.handle(
        jsonRequest(`${workspaceUrl}/files/file`, 'POST', {
          path: 'new.ts',
          confirmedNonCradleOwnedWrite: true,
        }),
      )
      expect(await createFileResponse.json()).toEqual(expect.objectContaining({ success: true }))

      const createFolderResponse = await app.handle(
        jsonRequest(`${workspaceUrl}/files/folder`, 'POST', {
          path: 'src/new',
          confirmedNonCradleOwnedWrite: true,
        }),
      )
      expect(await createFolderResponse.json()).toEqual(expect.objectContaining({ success: true }))

      const renameResponse = await app.handle(
        jsonRequest(`${workspaceUrl}/files/path`, 'PATCH', {
          sourcePath: 'new.ts',
          destinationPath: 'src/new.ts',
          confirmedNonCradleOwnedWrite: true,
        }),
      )
      expect(await renameResponse.json()).toEqual(expect.objectContaining({ success: true }))

      const unconfirmedResponse = await app.handle(
        jsonRequest(`${workspaceUrl}/files/content`, 'PUT', {
          path: 'notes.md',
          content: 'blocked',
          confirmedNonCradleOwnedWrite: false,
        }),
      )
      expect(unconfirmedResponse.status).toBe(400)

      const relinkResponse = await app.handle(
        jsonRequest(`${workspaceUrl}/location`, 'PATCH', {
          path: '/remote/renamed-project',
        }),
      )
      expect(await relinkResponse.json()).toEqual(
        expect.objectContaining({
          locator: {
            nodeId: 'node-studio',
            path: '/remote/renamed-project',
            sourceWorkspaceId: 'remote-workspace-1',
          },
        }),
      )

      expect(remoteServer.state.forwardedRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'GET',
            path: '/workspaces/remote-workspace-1/files/search?q=main&limit=5',
          }),
          expect.objectContaining({
            method: 'GET',
            path: '/workspaces/remote-workspace-1/files/events',
          }),
          expect.objectContaining({
            method: 'GET',
            path: '/workspaces/remote-workspace-1/files/raw?path=asset.bin',
          }),
          expect.objectContaining({
            method: 'GET',
            path: '/workspaces/remote-workspace-1/files/rendition/pdf?path=report.docx',
          }),
          expect.objectContaining({
            method: 'PUT',
            path: '/workspaces/remote-workspace-1/files/content',
          }),
          expect.objectContaining({
            method: 'POST',
            path: '/workspaces/remote-workspace-1/files/file',
          }),
          expect.objectContaining({
            method: 'POST',
            path: '/workspaces/remote-workspace-1/files/folder',
          }),
          expect.objectContaining({
            method: 'PATCH',
            path: '/workspaces/remote-workspace-1/files/path',
          }),
          expect.objectContaining({
            method: 'PATCH',
            path: '/workspaces/remote-workspace-1/location',
          }),
        ]),
      )
      expect(remoteServer.state.forwardedRequests).not.toContainEqual(
        expect.objectContaining({
          body: expect.objectContaining({ content: 'blocked' }),
        }),
      )
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })
})

function jsonRequest(url: string, method: 'PATCH' | 'POST' | 'PUT', body: object): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
