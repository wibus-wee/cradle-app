import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions } from '@cradle/db'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { publishSessionTailEvents } from '../src/modules/chat-runtime/es/event-tail'
import type { StoredChatSessionEvent } from '../src/modules/chat-runtime/es/events'
import { createFinalMessageProjectionState } from '../src/modules/chat-runtime/run/final-message-projection'
import type { ActiveRun } from '../src/modules/chat-runtime/run-registry'
import { runRegistry } from '../src/modules/chat-runtime/run-registry'
import { createRunChunkLog } from '../src/modules/chat-runtime/stream/run-chunk-log'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

const SyncServerFrameSchema = z.union([
  z.object({
    op: z.literal('pong'),
    ts: z.number(),
  }),
  z.object({
    subId: z.string(),
    kind: z.literal('sub-ack'),
    channel: z.string().optional(),
    runId: z.string().optional(),
    cursor: z.number(),
  }),
  z.object({
    subId: z.string(),
    kind: z.literal('chunk'),
    runId: z.string(),
    cursor: z.number(),
    chunk: z.object({ type: z.string() }).passthrough(),
    terminal: z.boolean(),
    replay: z.boolean(),
  }),
  z.object({
    subId: z.string(),
    seq: z.number().optional(),
    kind: z.literal('tail-event'),
    event: z.object({
      scope: z.literal('session'),
      sessionId: z.string(),
      version: z.number(),
      type: z.string(),
    }),
  }),
  z.object({
    subId: z.string(),
    kind: z.literal('end'),
    reason: z.string(),
    detail: z.string().optional(),
  }),
])

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-sync-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir

  try {
    return await callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
  }
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a TCP port')))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

function toWebSocketUrl(baseUrl: string, path: string): string {
  return baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + path
}

async function openSyncSocket(url: string): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function waitForSyncFrame(socket: WebSocket, timeoutMs = 5000): Promise<z.infer<typeof SyncServerFrameSchema>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for sync frame'))
    }, timeoutMs)

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const frame = SyncServerFrameSchema.parse(JSON.parse(String(data)))
        if ('op' in frame && frame.op === 'pong') {
          return
        }
        cleanup()
        resolve(frame)
      }
      catch {
        // ignore unrelated frames
      }
    }

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('message', onMessage)
    }

    socket.on('message', onMessage)
  })
}

async function startTestServer(): Promise<{ app: ElysiaApp, baseUrl: string }> {
  const app = await createServerApp({ startBackgroundTasks: false })
  const port = await getAvailablePort()
  app.listen({ hostname: '127.0.0.1', port })
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
  }
}

function seedSession(sessionId: string): void {
  db()
    .insert(sessions)
    .values({
      id: sessionId,
      title: 'Sync Socket Test',
      titleSource: 'initial',
      runtimeKind: 'standard',
      createdAt: 1700000000,
      updatedAt: 1700000000,
    })
    .run()
}

function registerActiveRun(sessionId: string, runId: string): ActiveRun {
  const activeRun: ActiveRun = {
    runId,
    sessionId,
    messageId: `${runId}-message`,
    providerTargetKind: null,
    providerTargetId: null,
    runtime: {} as ActiveRun['runtime'],
    runtimeSession: { runtimeKind: 'standard', providerSessionId: null } as ActiveRun['runtimeSession'],
    modelId: null,
    runChunkLog: createRunChunkLog(runId, 100),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: `${runId}-message`, role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    runSnapshotId: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotTruncatedEventId: null,
    runSnapshotDroppedEventCount: 0,
  }
  runRegistry.setActiveRun(runId, activeRun)
  runRegistry.setActiveRunIdForSession(sessionId, runId)
  return activeRun
}

describe('sync websocket', () => {
  it('replays and streams session tail events over /sync', async () => {
    await withTempDataDir(async () => {
      const { app, baseUrl } = await startTestServer()
      const sessionId = 'session-sync-1'
      seedSession(sessionId)

      const socket = await openSyncSocket(toWebSocketUrl(baseUrl, '/sync'))
      const subId = 'sub-session-tail-1'
      socket.send(JSON.stringify({
        op: 'sub',
        subId,
        channel: 'session-tail',
        sessionId,
        afterVersion: 0,
      }))

      const ack = await waitForSyncFrame(socket)
      expect(ack).toMatchObject({ subId, kind: 'sub-ack', cursor: 0 })

      publishSessionTailEvents([{
        sequenceId: 1,
        aggregateId: sessionId,
        aggregateType: 'ChatSession',
        version: 1,
        type: 'TitleChanged',
        payload: {
          sessionId,
          title: 'Updated via sync',
          titleSource: 'provider',
          updatedAt: 1700000001,
        },
        occurredAt: 1700000001,
      } satisfies StoredChatSessionEvent])

      const live = await waitForSyncFrame(socket)
      expect(live).toMatchObject({
        subId,
        kind: 'tail-event',
        event: {
          sessionId,
          version: 1,
          type: 'TitleChanged',
        },
      })

      socket.close()
      if (app.server) {
        await app.stop()
      }
    })
  }, 30_000)

  it('responds to ping with pong', async () => {
    await withTempDataDir(async () => {
      const { app, baseUrl } = await startTestServer()
      const socket = await openSyncSocket(toWebSocketUrl(baseUrl, '/sync'))
      const ts = Date.now()
      socket.send(JSON.stringify({ op: 'ping', ts }))

      const frame = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for pong')), 3000)
        socket.once('message', (data) => {
          clearTimeout(timer)
          resolve(JSON.parse(String(data)))
        })
      })

      expect(frame).toEqual({ op: 'pong', ts })
      socket.close()
      if (app.server) {
        await app.stop()
      }
    })
  }, 30_000)

  it('resumes run chunks by run-owned cursor across sockets', async () => {
    await withTempDataDir(async () => {
      const { app, baseUrl } = await startTestServer()
      const sessionId = 'session-run-sync-1'
      const runId = 'run-sync-1'
      seedSession(sessionId)
      const activeRun = registerActiveRun(sessionId, runId)
      activeRun.runChunkLog.append({ type: 'start', messageId: activeRun.messageId }, false)

      const firstSocket = await openSyncSocket(toWebSocketUrl(baseUrl, '/sync'))
      const firstFrame = waitForSyncFrame(firstSocket)
      firstSocket.send(JSON.stringify({
        op: 'sub',
        subId: 'run-sub-1',
        channel: 'run-chunks',
        sessionId,
      }))
      await expect(firstFrame).resolves.toMatchObject({
        kind: 'chunk',
        runId,
        cursor: 0,
        replay: true,
      })
      firstSocket.close()

      activeRun.runChunkLog.append({
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        output: 'done',
      }, false)

      const secondSocket = await openSyncSocket(toWebSocketUrl(baseUrl, '/sync'))
      const resumedFrame = waitForSyncFrame(secondSocket)
      secondSocket.send(JSON.stringify({
        op: 'sub',
        subId: 'run-sub-2',
        channel: 'run-chunks',
        sessionId,
        after: { runId, cursor: 0 },
      }))
      await expect(resumedFrame).resolves.toMatchObject({
        kind: 'chunk',
        runId,
        cursor: 1,
        chunk: { type: 'tool-output-available', toolCallId: 'tool-1' },
        replay: true,
      })

      const terminalFrame = waitForSyncFrame(secondSocket)
      activeRun.runChunkLog.append({ type: 'finish', finishReason: 'stop' }, true)
      await expect(terminalFrame).resolves.toMatchObject({
        kind: 'chunk',
        runId,
        cursor: 2,
        terminal: true,
        replay: false,
      })

      secondSocket.close()
      runRegistry.deleteActiveRun(runId)
      runRegistry.deleteActiveRunIdForSession(sessionId)
      if (app.server) {
        await app.stop()
      }
    })
  }, 30_000)

  it('keeps an empty active run subscription live until its first chunk', async () => {
    await withTempDataDir(async () => {
      const { app, baseUrl } = await startTestServer()
      const sessionId = 'session-empty-run-sync'
      const runId = 'run-empty-sync'
      seedSession(sessionId)
      const activeRun = registerActiveRun(sessionId, runId)

      const socket = await openSyncSocket(toWebSocketUrl(baseUrl, '/sync'))
      const ackFrame = waitForSyncFrame(socket)
      socket.send(JSON.stringify({
        op: 'sub',
        subId: 'run-empty-sub',
        channel: 'run-chunks',
        sessionId,
      }))
      await expect(ackFrame).resolves.toMatchObject({
        kind: 'sub-ack',
        channel: 'run-chunks',
        runId,
        cursor: -1,
      })

      const liveFrame = waitForSyncFrame(socket)
      activeRun.runChunkLog.append({ type: 'start', messageId: activeRun.messageId }, false)
      await expect(liveFrame).resolves.toMatchObject({
        kind: 'chunk',
        runId,
        cursor: 0,
        replay: false,
      })

      socket.close()
      runRegistry.deleteActiveRun(runId)
      runRegistry.deleteActiveRunIdForSession(sessionId)
      if (app.server) {
        await app.stop()
      }
    })
  }, 30_000)
})
