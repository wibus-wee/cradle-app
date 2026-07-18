import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { workspaceFixture } from './helpers/workspace-fixture'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

type ChatMessageSnapshot = {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  content: string
  message: {
    parts: Array<{ type: string, text?: string, state?: string }>
  }
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfileAndSession(app: ElysiaApp, workspaceRoot: string) {
  db().insert(workspaces).values({
    ...workspaceFixture({
      id: 'workspace-observability',
      name: 'Workspace Observability',
      path: workspaceRoot,
    }),
  }).run()

  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'openai-compatible',
      label: 'Observability Key',
      secret: 'sk-observability-test',
    }),
  }))
  const credential = await credentialRes.json() as { id: string }

  const targetRes = await app.handle(new Request('http://localhost/provider-targets/provider-target-observability', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Observability Provider',
      providerKind: 'openai-compatible',
      enabled: true,
      connectionConfig: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
      credentialRef: credential.id,
    }),
  }))
  expect(targetRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'session-observability',
      workspaceId: 'workspace-observability',
      title: 'Observability Session',
      providerTargetId: 'provider-target-observability',
      runtimeKind: 'standard',
    }),
  }))
  expect(sessionRes.status).toBe(200)
}

async function waitForLatestAssistantStatus(
  app: ElysiaApp,
  sessionId: string,
  expectedStatus: ChatMessageSnapshot['status'],
  expectedAssistantCount: number,
): Promise<ChatMessageSnapshot[]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const { rows: groups } = await response.json() as { revision: number, rows: ChatMessageSnapshot[] }
      const assistants = groups.filter(group => group.role === 'assistant')
      const latestAssistant = assistants.at(-1)
      if (assistants.length === expectedAssistantCount && latestAssistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for latest assistant status ${expectedStatus}`)
}

async function flushObservability(app: ElysiaApp): Promise<void> {
  const response = await app.handle(new Request('http://localhost/observability/flush', { method: 'POST' }))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
}

describe('observability capability', () => {
  it('keeps valid events when another queued event violates a relation', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-observability-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousPluginsDir = process.env.CRADLE_PLUGINS_DIR
    const previousExternalPluginsDirs = process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'observability-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      await createProfileAndSession(app, workspaceRoot)

      const invalidEventRes = await app.handle(new Request('http://localhost/observability/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'renderer',
          code: 'OBSERVABILITY_TEST_INVALID_RELATION',
          severity: 'info',
          category: 'diagnostics',
          message: 'event points at a missing chat session',
          chatSessionId: 'missing-session-for-observability-fallback',
        }),
      }))
      expect(invalidEventRes.status).toBe(200)

      const validEventRes = await app.handle(new Request('http://localhost/observability/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'renderer',
          code: 'OBSERVABILITY_TEST_VALID_RELATION',
          severity: 'info',
          category: 'diagnostics',
          message: 'event points at an existing chat session',
          chatSessionId: 'session-observability',
        }),
      }))
      expect(validEventRes.status).toBe(200)

      await flushObservability(app)

      const eventsRes = await app.handle(new Request('http://localhost/observability/events?chatSessionId=session-observability&code=OBSERVABILITY_TEST_VALID_RELATION'))
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json() as Array<{ code: string, chatSessionId?: string }>
      expect(events).toEqual([
        expect.objectContaining({
          code: 'OBSERVABILITY_TEST_VALID_RELATION',
          chatSessionId: 'session-observability',
        }),
      ])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      if (previousPluginsDir === undefined) {
        delete process.env.CRADLE_PLUGINS_DIR
      }
      else {
        process.env.CRADLE_PLUGINS_DIR = previousPluginsDir
      }
      if (previousExternalPluginsDirs === undefined) {
        delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
      }
      else {
        process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = previousExternalPluginsDirs
      }
    }
  })

  it('records local producer errors and exports a redacted diagnostics bundle', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const logFile = join(dataDir, 'server.log')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousLogFile = process.env.CRADLE_LOG_FILE
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousPluginsDir = process.env.CRADLE_PLUGINS_DIR
    const previousExternalPluginsDirs = process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_LOG_FILE = logFile
    process.env.CRADLE_CREDENTIAL_SECRET = 'observability-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    writeFileSync(
      logFile,
      [
        `path=${process.env.HOME ?? ''}/Library/Application Support/@cradle/desktop/data`,
        'api_key=sk-observability-test-local-producer',
        'token=private-preview-token',
        'authorization: Bearer private-preview-bearer',
      ].join('\n'),
    )

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()

      const eventRes = await app.handle(new Request('http://localhost/observability/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'renderer',
          code: 'RENDERER_UNHANDLED_ERROR',
          severity: 'error',
          category: 'diagnostics',
          message: 'renderer crashed while opening settings',
          attrs: {
            error: {
              stack: `Error: boom\n    at ${process.env.HOME ?? ''}/Cradle/apps/web/src/main.tsx:1:1\n    api_key=sk-renderer-secret-value`,
            },
          },
        }),
      }))
      expect(eventRes.status).toBe(200)
      expect(await eventRes.json()).toEqual({ ok: true })

      await flushObservability(app)

      const incidentsRes = await app.handle(new Request('http://localhost/observability/incidents?code=RENDERER_UNHANDLED_ERROR'))
      expect(incidentsRes.status).toBe(200)
      const incidents = await incidentsRes.json() as Array<{ code: string, status: string }>
      expect(incidents).toEqual([expect.objectContaining({ code: 'RENDERER_UNHANDLED_ERROR', status: 'open' })])

      const exportRes = await app.handle(new Request('http://localhost/observability/export'))
      expect(exportRes.status).toBe(200)
      const bundle = await exportRes.json() as {
        schema: string
        metadata: { [key: string]: unknown }
        redaction: { [key: string]: unknown }
        events: Array<{ code: string, attrs?: { error?: { stack?: string } } }>
        incidents: Array<{ code: string }>
        errorPatterns: Array<{ code: string }>
        timeline: Array<Record<string, unknown>>
        logs: { serverLog?: { available?: boolean, path?: string | null, tail?: string } }
      }
      expect(bundle.schema).toBe('cradle.diagnostics.bundle.v1')
      expect(bundle.metadata).toEqual(expect.objectContaining({
        app: expect.any(Object),
        server: expect.any(Object),
        runtime: expect.any(Object),
        os: expect.any(Object),
      }))
      expect(bundle.redaction).toEqual(expect.objectContaining({ applied: true, version: 1 }))
      expect(bundle.events).toEqual([expect.objectContaining({ code: 'RENDERER_UNHANDLED_ERROR' })])
      expect(bundle.events[0]?.attrs?.error?.stack).toContain('~/Cradle/apps/web/src/main.tsx')
      expect(bundle.events[0]?.attrs?.error?.stack).not.toContain('sk-renderer-secret-value')
      expect(bundle.incidents).toEqual([expect.objectContaining({ code: 'RENDERER_UNHANDLED_ERROR' })])
      expect(bundle.errorPatterns).toEqual([expect.objectContaining({ code: 'RENDERER_UNHANDLED_ERROR' })])
      expect(bundle.timeline).toEqual([])
      expect(bundle.logs.serverLog).toEqual(expect.objectContaining({ available: true }))
      expect(bundle.logs.serverLog?.tail).not.toContain(process.env.HOME ?? 'unreachable-home')
      expect(bundle.logs.serverLog?.tail).toContain('~/Library/Application Support/@cradle/desktop/data')
      expect(bundle.logs.serverLog?.tail).not.toContain('sk-observability-test-local-producer')
      expect(bundle.logs.serverLog?.tail).not.toContain('private-preview-token')
      expect(bundle.logs.serverLog?.tail).not.toContain('private-preview-bearer')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousLogFile === undefined) {
        delete process.env.CRADLE_LOG_FILE
      }
      else {
        process.env.CRADLE_LOG_FILE = previousLogFile
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      if (previousPluginsDir === undefined) {
        delete process.env.CRADLE_PLUGINS_DIR
      }
      else {
        process.env.CRADLE_PLUGINS_DIR = previousPluginsDir
      }
      if (previousExternalPluginsDirs === undefined) {
        delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
      }
      else {
        process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = previousExternalPluginsDirs
      }
    }
  })

  it('records empty-output failures, opens an incident at threshold, and exports the related bundle', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-observability-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousPluginsDir = process.env.CRADLE_PLUGINS_DIR
    const previousExternalPluginsDirs = process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'observability-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        return new Response(new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode('data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}\n\n'))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          },
        }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      await createProfileAndSession(app, workspaceRoot)

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-observability/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `empty output attempt ${attempt}`, modelId: 'gpt-4o-mini' }),
        }))
        expect(runRes.status).toBe(200)

        const timeline = await waitForLatestAssistantStatus(app, 'session-observability', 'failed', attempt)
        const latestAssistant = timeline.filter(group => group.role === 'assistant').at(-1)
        expect(latestAssistant).toEqual(expect.objectContaining({ status: 'failed' }))
        expect(latestAssistant?.errorText).toBeTruthy()
      }

      await flushObservability(app)

      const eventsRes = await app.handle(new Request('http://localhost/observability/events?chatSessionId=session-observability&code=CHAT_EMPTY_OUTPUT_COMPLETION'))
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json() as Array<{ code: string, runId?: string, severity: string }>
      expect(events).toHaveLength(3)
      expect(events.every(event => event.code === 'CHAT_EMPTY_OUTPUT_COMPLETION')).toBe(true)
      expect(events.every(event => event.severity === 'error')).toBe(true)
      const finalRunId = events.at(-1)?.runId ?? ''
      expect(finalRunId).not.toBe('')

      const incidentsRes = await app.handle(new Request('http://localhost/observability/incidents?chatSessionId=session-observability&code=CHAT_EMPTY_OUTPUT_COMPLETION'))
      expect(incidentsRes.status).toBe(200)
      const incidents = await incidentsRes.json() as Array<{ code: string, status: string, attrs?: { occurrences?: number } }>
      expect(incidents).toHaveLength(1)
      expect(incidents[0]).toEqual(expect.objectContaining({
        code: 'CHAT_EMPTY_OUTPUT_COMPLETION',
        status: 'open',
      }))
      expect(incidents[0].attrs?.occurrences).toBe(3)

      const exportRes = await app.handle(new Request(`http://localhost/observability/export?runId=${encodeURIComponent(finalRunId)}`))
      expect(exportRes.status).toBe(200)
      const bundle = await exportRes.json() as {
        events: Array<{ runId?: string, code: string }>
        incidents: Array<{ runId?: string, code: string }>
        errorPatterns: Array<{ code: string, count: number, sampleRunIds: string[], sampleTraceIds: string[] }>
        timeline: Array<{ runId: string, schema: string, status: string, events: Array<{ phase: string }> }>
      }
      expect(bundle.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ runId: finalRunId, code: 'CHAT_EMPTY_OUTPUT_COMPLETION' }),
      ]))
      expect(bundle.incidents).toEqual([])
      expect(bundle.errorPatterns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'CHAT_EMPTY_OUTPUT_COMPLETION',
          count: 1,
          sampleRunIds: [finalRunId],
        }),
        expect.objectContaining({
          code: 'RUN_RESPONSE_FAILED',
          count: 1,
          sampleRunIds: [finalRunId],
          sampleTraceIds: [finalRunId],
        }),
      ]))
      expect(bundle.timeline).toEqual([
        expect.objectContaining({
          schema: 'cradle.backend-run-snapshot.v1',
          runId: finalRunId,
          status: 'failed',
          events: expect.arrayContaining([
            expect.objectContaining({ phase: 'run_started' }),
            expect.objectContaining({ phase: 'model_stream_started' }),
            expect.objectContaining({ phase: 'model_stream_finished' }),
            expect.objectContaining({ phase: 'run_finalized' }),
          ]),
        }),
      ])
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(3)
    }
    finally {
      fetchSpy.mockRestore()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      if (previousPluginsDir === undefined) {
        delete process.env.CRADLE_PLUGINS_DIR
      }
      else {
        process.env.CRADLE_PLUGINS_DIR = previousPluginsDir
      }
      if (previousExternalPluginsDirs === undefined) {
        delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
      }
      else {
        process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = previousExternalPluginsDirs
      }
    }
  })

  it('records stream failures as events and incidents', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-observability-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousPluginsDir = process.env.CRADLE_PLUGINS_DIR
    const previousExternalPluginsDirs = process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'observability-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        throw new Error('provider stream exploded')
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      await createProfileAndSession(app, workspaceRoot)

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-observability/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'explode stream', modelId: 'gpt-4o-mini' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForLatestAssistantStatus(app, 'session-observability', 'failed', 1)
      const latestAssistant = timeline.filter(group => group.role === 'assistant').at(-1)
      expect(latestAssistant?.errorText).toBeTruthy()

      await flushObservability(app)

      const eventsRes = await app.handle(new Request('http://localhost/observability/events?code=TURN_STREAM_FAILED'))
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json() as Array<{ code: string, message: string, runId?: string }>
      expect(events).toEqual([expect.objectContaining({ code: 'TURN_STREAM_FAILED' })])
      const runId = events[0]?.runId ?? ''
      expect(runId).not.toBe('')

      const incidentsRes = await app.handle(new Request('http://localhost/observability/incidents?code=TURN_STREAM_FAILED'))
      expect(incidentsRes.status).toBe(200)
      const incidents = await incidentsRes.json() as Array<{ code: string, status: string, dedupeKey?: string }>
      expect(incidents).toEqual([expect.objectContaining({
        code: 'TURN_STREAM_FAILED',
        dedupeKey: 'TURN_STREAM_FAILED:-:-:-',
        status: 'open',
      })])
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(1)
    }
    finally {
      fetchSpy.mockRestore()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      if (previousPluginsDir === undefined) {
        delete process.env.CRADLE_PLUGINS_DIR
      }
      else {
        process.env.CRADLE_PLUGINS_DIR = previousPluginsDir
      }
      if (previousExternalPluginsDirs === undefined) {
        delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
      }
      else {
        process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = previousExternalPluginsDirs
      }
    }
  })
})
