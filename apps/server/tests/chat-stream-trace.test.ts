// Focused coverage for chat stream trace filesystem persistence.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, messages, providerTargets, sessions, workspaces } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import {
  readChatRunTrace,
  recordChatStreamTrace,
  resolveChatStreamTracePath,
} from '../src/modules/chat-runtime/stream-trace'
import { workspaceFixture } from './helpers/workspace-fixture'

describe('chat stream trace', () => {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    trace: process.env.CRADLE_CHAT_STREAM_TRACE,
    traceFull: process.env.CRADLE_CHAT_STREAM_TRACE_FULL,
    traceReadLimit: process.env.CRADLE_CHAT_STREAM_TRACE_READ_LIMIT,
    traceReadBytes: process.env.CRADLE_CHAT_STREAM_TRACE_READ_BYTES,
    secret: process.env.CRADLE_CREDENTIAL_SECRET,
  }
  const tempDirs: string[] = []

  afterEach(() => {
    shutdownInfra()

    if (previous.dataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previous.dataDir
    }

    if (previous.trace === undefined) {
      delete process.env.CRADLE_CHAT_STREAM_TRACE
    }
    else {
      process.env.CRADLE_CHAT_STREAM_TRACE = previous.trace
    }

    if (previous.traceFull === undefined) {
      delete process.env.CRADLE_CHAT_STREAM_TRACE_FULL
    }
    else {
      process.env.CRADLE_CHAT_STREAM_TRACE_FULL = previous.traceFull
    }

    if (previous.traceReadLimit === undefined) {
      delete process.env.CRADLE_CHAT_STREAM_TRACE_READ_LIMIT
    }
    else {
      process.env.CRADLE_CHAT_STREAM_TRACE_READ_LIMIT = previous.traceReadLimit
    }

    if (previous.traceReadBytes === undefined) {
      delete process.env.CRADLE_CHAT_STREAM_TRACE_READ_BYTES
    }
    else {
      process.env.CRADLE_CHAT_STREAM_TRACE_READ_BYTES = previous.traceReadBytes
    }

    if (previous.secret === undefined) {
      delete process.env.CRADLE_CREDENTIAL_SECRET
    }
    else {
      process.env.CRADLE_CREDENTIAL_SECRET = previous.secret
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('writes and reads ordered JSONL records by run id', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '1'

    const context = {
      chatSessionId: 'session-1',
      runId: 'run-1',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      providerSessionId: null,
    }

    recordChatStreamTrace({
      ...context,
      phase: 'provider_raw',
      payload: { type: 'stream_event' },
    })
    recordChatStreamTrace({
      ...context,
      phase: 'mapper_output',
      payload: { chunks: [{ type: 'tool-input-delta' }] },
    })

    const trace = readChatRunTrace('run-1')

    expect(trace.path).toBe(resolveChatStreamTracePath('run-1'))
    expect(trace.recordCount).toBe(2)
    expect(trace.records.map(record => record.seq)).toEqual([0, 1])
    expect(trace.records.map(record => record.phase)).toEqual(['provider_raw', 'mapper_output'])
  })

  it('does not write traces when explicitly disabled', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-disabled-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '0'

    recordChatStreamTrace({
      chatSessionId: 'session-1',
      runId: 'run-disabled',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      phase: 'provider_raw',
      payload: { type: 'stream_event' },
    })

    expect(existsSync(resolveChatStreamTracePath('run-disabled'))).toBe(false)
  })

  it('does not write traces by default', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-default-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_CHAT_STREAM_TRACE

    recordChatStreamTrace({
      chatSessionId: 'session-1',
      runId: 'run-default',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      phase: 'provider_raw',
      payload: { type: 'stream_event' },
    })

    expect(existsSync(resolveChatStreamTracePath('run-default'))).toBe(false)
  })

  it('bounds trace payloads unless full tracing is explicitly enabled', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-bounded-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '1'

    recordChatStreamTrace({
      chatSessionId: 'session-1',
      runId: 'run-bounded',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      phase: 'provider_raw',
      payload: { content: 'x'.repeat(3000) },
    })

    const trace = readChatRunTrace('run-bounded')

    expect(trace.records[0]?.payload).toEqual({
      content: {
        type: 'cradle.trace-truncated-string.v1',
        originalLength: 3000,
        preview: 'x'.repeat(2000),
      },
    })
  })

  it('reads trace records from the file tail using bounded bytes', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-tail-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '1'
    process.env.CRADLE_CHAT_STREAM_TRACE_READ_LIMIT = '3'
    process.env.CRADLE_CHAT_STREAM_TRACE_READ_BYTES = '2600'

    const context = {
      chatSessionId: 'session-1',
      runId: 'run-tail',
      messageId: 'message-1',
      runtimeKind: 'claude-agent',
      providerSessionId: null,
    }

    for (let index = 0; index < 10; index += 1) {
      recordChatStreamTrace({
        ...context,
        phase: 'provider_raw',
        payload: { index, content: 'x'.repeat(300) },
      })
    }

    const trace = readChatRunTrace('run-tail')

    expect(trace.recordCount).toBe(10)
    expect(trace.records.map(record => (record.payload as { index: number }).index)).toEqual([7, 8, 9])
  })

  it('returns decoded trace records by run id and session id through chat routes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-trace-route-'))
    tempDirs.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CHAT_STREAM_TRACE = '1'
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-stream-trace-secret'

    const app = await createServerApp({ startBackgroundTasks: false })
    const now = 1700000000

    db().insert(workspaces).values({
      ...workspaceFixture({
        id: 'workspace-trace-route',
        name: 'Trace Route Workspace',
        path: dataDir,
      }),
    }).run()
    db().insert(providerTargets).values({
      id: 'provider-target-trace-route',
      kind: 'manual',
      displayName: 'Trace Route Provider',
      providerKind: 'anthropic',
      enabled: true,
      connectionConfigJson: JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
      credentialRef: null,
      iconSlug: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(sessions).values({
      id: 'session-trace-route',
      workspaceId: 'workspace-trace-route',
      title: 'Trace Route Session',
      providerTargetId: 'provider-target-trace-route',
      runtimeKind: 'claude-agent',
      configJson: '{}',
      pinned: 0,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(messages).values({
      id: 'message-trace-route',
      sessionId: 'session-trace-route',
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: 'assistant',
      status: 'streaming',
      content: '',
      messageJson: JSON.stringify({ id: 'message-trace-route', role: 'assistant', parts: [] }),
      errorText: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    db().insert(backendRuns).values({
      id: 'run-trace-route',
      bindingId: null,
      chatSessionId: 'session-trace-route',
      messageId: 'message-trace-route',
      origin: 'user',
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: now,
      finishedAt: null,
    }).run()

    recordChatStreamTrace({
      chatSessionId: 'session-trace-route',
      runId: 'run-trace-route',
      messageId: 'message-trace-route',
      runtimeKind: 'claude-agent',
      providerSessionId: null,
      phase: 'provider_raw',
      payload: { type: 'stream_event', event: { type: 'content_block_delta' } },
    })

    const runResponse = await app.handle(new Request('http://localhost/chat/runs/run-trace-route/trace'))
    expect(runResponse.status).toBe(200)
    const runTrace = await runResponse.json() as { runId: string, recordCount: number, records: Array<{ phase: string }> }
    expect(runTrace.runId).toBe('run-trace-route')
    expect(runTrace.recordCount).toBe(1)
    expect(runTrace.records[0]?.phase).toBe('provider_raw')

    const sessionResponse = await app.handle(new Request('http://localhost/chat/sessions/session-trace-route/traces'))
    expect(sessionResponse.status).toBe(200)
    const sessionTrace = await sessionResponse.json() as { sessionId: string, traces: Array<{ runId: string, recordCount: number }> }
    expect(sessionTrace.sessionId).toBe('session-trace-route')
    expect(sessionTrace.traces).toEqual([
      expect.objectContaining({ runId: 'run-trace-route', recordCount: 1 }),
    ])
  })
})
