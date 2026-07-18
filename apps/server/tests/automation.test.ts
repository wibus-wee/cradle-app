import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { automationDefinitions, automationRuns, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { listDueOccurrences } from '../src/modules/automation/scheduler'
import * as Automation from '../src/modules/automation/service'
import { workspaceFixture } from './helpers/workspace-fixture'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

const ChatCompletionRequestBodyJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })),
  }))

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function buildSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function createProfile(app: ElysiaApp, profileId: string): Promise<void> {
  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'openai-compatible',
      label: 'Automation Key',
      secret: 'sk-automation-test',
    }),
  }))
  expect(credentialRes.status).toBe(200)
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await app.handle(new Request(`http://localhost/profiles/${profileId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Automation Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
      credentialRef: credential.id,
    }),
  }))
  expect(profileRes.status).toBe(200)
}

async function createAutomation(app: ElysiaApp, input?: { id?: string, workspaceId?: string, profileId?: string }) {
  const automationId = input?.id ?? 'automation-weekly-report'
  const profileId = input?.profileId ?? 'profile-automation'
  const body = {
    id: automationId,
    workspaceId: input?.workspaceId ?? 'workspace-automation',
    title: 'Weekly report',
    description: 'Summarize current project state',
    trigger: {
      type: 'rrule',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
      timezone: 'Asia/Shanghai',
      misfirePolicy: 'skip',
    },
    recipe: {
      kind: 'agent_task',
      prompt: 'Write a concise weekly report.',
      inputs: [
        { type: 'text', name: 'scope', content: 'Cradle automation platform' },
      ],
      artifactRequests: [
        { kind: 'markdown', name: 'weekly-report.md', description: 'Final report' },
      ],
      providerTargetId: profileId,
      modelId: 'gpt-4o-mini',
      runtimeKind: 'standard',
    },
    createdByKind: 'agent',
  }
  const response = await app.handle(new Request('http://localhost/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  expect(response.status).toBe(200)
  return await response.json() as typeof body & {
    id: string
    enabled: boolean
    nextRunAt: number | null
  }
}

async function createAutomationWithInputs(app: ElysiaApp, inputs: Array<Record<string, unknown>>) {
  return app.handle(new Request('http://localhost/automations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `automation-${randomUUID()}`,
      workspaceId: 'workspace-automation',
      title: 'File input validation',
      description: 'Validate file reference shape',
      trigger: {
        type: 'rrule',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
        timezone: 'Asia/Shanghai',
      },
      recipe: {
        kind: 'agent_task',
        prompt: 'Read the input.',
        inputs,
        artifactRequests: [],
        providerTargetId: 'profile-automation',
      },
    }),
  }))
}

describe('automation capability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports CRUD and enable/disable for Agent-authored definitions', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'automation-secret'
    let app: ElysiaApp | undefined

    try {
      app = await createServerApp({ startBackgroundTasks: false })
      db().insert(workspaces).values({
        ...workspaceFixture({
          id: 'workspace-automation',
          name: 'Workspace Automation',
          path: workspaceRoot,
        }),
      }).run()
      await createProfile(app, 'profile-automation')

      const relativeFileRefRes = await createAutomationWithInputs(app, [
        { type: 'file_ref', path: 'relative/report.md' },
      ])
      expect(relativeFileRefRes.status).toBe(400)

      const inlineFileRes = await createAutomationWithInputs(app, [
        { type: 'inline_file', name: 'report.md', content: '# Report' },
      ])
      expect(inlineFileRes.status).toBe(200)

      const created = await createAutomation(app)
      expect(created).toEqual(expect.objectContaining({
        id: 'automation-weekly-report',
        title: 'Weekly report',
        enabled: true,
        nextRunAt: expect.any(Number),
      }))

      const listRes = await app.handle(new Request('http://localhost/automations?workspaceId=workspace-automation'))
      expect(listRes.status).toBe(200)
      const list = await listRes.json()
      expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'automation-weekly-report' })]))

      const getRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report'))
      expect(await getRes.json()).toEqual(expect.objectContaining({
        id: 'automation-weekly-report',
        recipe: expect.objectContaining({ providerTargetId: 'profile-automation' }),
      }))

      const updateRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed report', description: 'Updated' }),
      }))
      expect(updateRes.status).toBe(200)
      expect(await updateRes.json()).toEqual(expect.objectContaining({ title: 'Renamed report', description: 'Updated' }))

      const disableRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report/disable', {
        method: 'POST',
      }))
      expect(disableRes.status).toBe(200)
      expect(await disableRes.json()).toEqual(expect.objectContaining({ enabled: false, nextRunAt: null }))

      const enableRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report/enable', {
        method: 'POST',
      }))
      expect(enableRes.status).toBe(200)
      expect(await enableRes.json()).toEqual(expect.objectContaining({ enabled: true, nextRunAt: expect.any(Number) }))

      const deleteRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report', {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
      if (previousSecret === undefined) { delete process.env.CRADLE_CREDENTIAL_SECRET }
      else { process.env.CRADLE_CREDENTIAL_SECRET = previousSecret }
    }
  })

  it('exposes Yansu cron-compatible routes backed by Automation ownership', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'automation-secret'
    let app: ElysiaApp | undefined

    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new Request(input).url
        if (url.endsWith('/chat/completions')) {
          return buildSseResponse([
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Scheduled report"},"finish_reason":null}]}\n\n',
            'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}\n\n',
            'data: [DONE]\n\n',
          ])
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      })

      app = await createServerApp({ startBackgroundTasks: false })
      db().insert(workspaces).values({
        ...workspaceFixture({
          id: 'workspace-automation',
          name: 'Workspace Automation',
          path: workspaceRoot,
        }),
      }).run()
      await createProfile(app, 'profile-automation')

      const createRes = await app.handle(new Request('http://localhost/cron/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'cron-weekly-report',
          workspaceId: 'workspace-automation',
          title: 'Cron weekly report',
          description: 'Yansu-compatible cron facade',
          scheduleKind: 'rrule',
          scheduleConfig: 'FREQ=WEEKLY;BYDAY=TU;BYHOUR=10;BYMINUTE=0;BYSECOND=0',
          timezone: 'Asia/Shanghai',
          prompt: 'Write the cron report.',
          providerTargetId: 'profile-automation',
          modelId: 'gpt-4o-mini',
        }),
      }))
      expect(createRes.status).toBe(200)
      expect(await createRes.json()).toEqual(expect.objectContaining({
        id: 'cron-weekly-report',
        automationDefinitionId: 'cron-weekly-report',
        scheduleKind: 'rrule',
        scheduleConfig: 'FREQ=WEEKLY;BYDAY=TU;BYHOUR=10;BYMINUTE=0;BYSECOND=0',
        prompt: 'Write the cron report.',
      }))

      const listRes = await app.handle(new Request('http://localhost/cron/jobs?workspaceId=workspace-automation'))
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'cron-weekly-report' }),
      ]))

      const updateRes = await app.handle(new Request('http://localhost/cron/jobs/cron-weekly-report', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Renamed cron report',
          enabled: false,
          prompt: 'Write the renamed cron report.',
        }),
      }))
      expect(updateRes.status).toBe(200)
      expect(await updateRes.json()).toEqual(expect.objectContaining({
        title: 'Renamed cron report',
        enabled: false,
        prompt: 'Write the renamed cron report.',
        nextRunAt: null,
      }))

      const getRes = await app.handle(new Request('http://localhost/cron/jobs/cron-weekly-report'))
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toEqual(expect.objectContaining({
        id: 'cron-weekly-report',
        enabled: false,
      }))

      const runsRes = await app.handle(new Request('http://localhost/cron/runs?jobId=cron-weekly-report'))
      expect(runsRes.status).toBe(200)
      expect(await runsRes.json()).toEqual([])

      const deleteRes = await app.handle(new Request('http://localhost/cron/jobs/cron-weekly-report', {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
      if (previousSecret === undefined) { delete process.env.CRADLE_CREDENTIAL_SECRET }
      else { process.env.CRADLE_CREDENTIAL_SECRET = previousSecret }
    }
  })

  it('computes RRULE due occurrences and deduplicates scheduled enqueues', async () => {
    const due = listDueOccurrences({
      type: 'rrule',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
      timezone: 'Asia/Shanghai',
    }, {
      windowStart: Date.parse('2026-05-17T00:00:00.000Z') / 1000,
      windowEnd: Date.parse('2026-05-19T00:00:00.000Z') / 1000,
    })
    expect(due).toHaveLength(1)
    expect(due[0].occurrenceKey).toBe(`scheduled:${due[0].scheduledFor}`)

    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'automation-secret'
    let app: ElysiaApp | undefined

    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new Request(input).url
        if (url.endsWith('/chat/completions')) {
          return buildSseResponse([
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Scheduled report"},"finish_reason":null}]}\n\n',
            'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}\n\n',
            'data: [DONE]\n\n',
          ])
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      })

      app = await createServerApp({ startBackgroundTasks: false })
      db().insert(workspaces).values({
        ...workspaceFixture({
          id: 'workspace-automation',
          name: 'Workspace Automation',
          path: workspaceRoot,
        }),
      }).run()
      await createProfile(app, 'profile-automation')
      await createAutomation(app)

      const first = await app.handle(new Request('http://localhost/automations/automation-weekly-report/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ occurrenceKey: 'scheduled:1779056400', scheduledFor: 1779056400 }),
      }))
      expect(first.status).toBe(200)

      const second = await app.handle(new Request('http://localhost/automations/automation-weekly-report/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ occurrenceKey: 'scheduled:1779056400', scheduledFor: 1779056400 }),
      }))
      expect(second.status).toBeGreaterThanOrEqual(400)

      const rows = db().select().from(automationRuns).where(eq(automationRuns.occurrenceKey, 'scheduled:1779056400')).all()
      expect(rows).toHaveLength(1)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
      if (previousSecret === undefined) { delete process.env.CRADLE_CREDENTIAL_SECRET }
      else { process.env.CRADLE_CREDENTIAL_SECRET = previousSecret }
    }
  })

  it('enqueues from persisted nextRunAt when the server missed the lookback window', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'automation-secret'
    let app: ElysiaApp | undefined

    try {
      app = await createServerApp({ startBackgroundTasks: false })
      db().insert(workspaces).values({
        ...workspaceFixture({
          id: 'workspace-automation',
          name: 'Workspace Automation',
          path: workspaceRoot,
        }),
      }).run()
      await createProfile(app, 'profile-automation')
      await createAutomation(app)

      const now = Date.parse('2026-05-25T04:00:00.000Z') / 1000
      db().update(automationDefinitions).set({
        nextRunAt: 1779670800,
      }).where(eq(automationDefinitions.id, 'automation-weekly-report')).run()
      const runs = Automation.enqueueDueRuns({
        now,
        lookbackSeconds: 60,
      })

      expect(runs).toHaveLength(1)
      expect(runs[0]).toEqual(expect.objectContaining({
        triggerType: 'scheduled',
        occurrenceKey: 'scheduled:1779670800',
        scheduledFor: 1779670800,
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
      if (previousSecret === undefined) { delete process.env.CRADLE_CREDENTIAL_SECRET }
      else { process.env.CRADLE_CREDENTIAL_SECRET = previousSecret }
    }
  })

  it('run-now creates normal chat runtime records and persists a markdown artifact', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'automation-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = ChatCompletionRequestBodyJsonSchema.parse(String(init?.body))
        expect(payload.messages.at(-1)?.content).toContain('Write a concise weekly report.')
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Automation report"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp({ startBackgroundTasks: false })
      db().insert(workspaces).values({
        ...workspaceFixture({
          id: 'workspace-automation',
          name: 'Workspace Automation',
          path: workspaceRoot,
        }),
      }).run()
      await createProfile(app, 'profile-automation')
      await createAutomation(app)

      const runRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(runRes.status).toBe(200)
      const run = await runRes.json() as {
        id: string
        status: string
        chatSessionId: string | null
        backendRunId: string | null
        artifactCount: number
      }
      expect(run).toEqual(expect.objectContaining({
        status: 'complete',
        chatSessionId: expect.any(String),
        backendRunId: expect.any(String),
        artifactCount: 1,
      }))
      const chatSession = db().select().from(sessions).where(eq(sessions.id, run.chatSessionId!)).get()
      expect(chatSession?.origin).toBe('automation')

      const runsRes = await app.handle(new Request('http://localhost/automations/automation-weekly-report/runs'))
      expect(await runsRes.json()).toEqual([expect.objectContaining({ id: run.id, backendRunId: run.backendRunId })])

      const artifactsRes = await app.handle(new Request(`http://localhost/automations/automation-weekly-report/runs/${run.id}/artifacts`))
      expect(artifactsRes.status).toBe(200)
      const artifacts = await artifactsRes.json() as Array<{ id: string, content: string }>
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0].content).toContain('Automation report')

      const artifactRes = await app.handle(new Request(`http://localhost/automations/automation-weekly-report/artifacts/${artifacts[0].id}`))
      expect(await artifactRes.json()).toEqual(expect.objectContaining({
        id: artifacts[0].id,
        kind: 'markdown',
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
      if (previousSecret === undefined) { delete process.env.CRADLE_CREDENTIAL_SECRET }
      else { process.env.CRADLE_CREDENTIAL_SECRET = previousSecret }
    }
  })
})
