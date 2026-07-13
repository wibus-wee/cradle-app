import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentCredentials,
  agents,
  backendCapabilitySnapshots,
  backendSessionBindings,
  chatSessionQueueItems,
  messages,
  providerTargetModelCache,
  providerTargets,
  runtimeAuditLog,
  sessions,
  usageLogs,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { setCodexChatgptModelListClientFactoryForTests } from '../src/modules/chat-runtime-providers/codex/app-server/model-list'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const ProfileResponseSchema = z.object({
  configJson: z.string(),
  customModels: z.string(),
})
function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return new Request(input).url
}

describe('profiles capability', () => {
  afterEach(() => {
    setCodexChatgptModelListClientFactoryForTests(null)
    vi.restoreAllMocks()
  })

  it('supports secret masking, profile CRUD, and model listing', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profiles'

    const codexClientOptions: unknown[] = []
    setCodexChatgptModelListClientFactoryForTests((options) => {
      codexClientOptions.push(options)
      return {
        async initialize() {},
        async request(method) {
          if (method === 'model/list') {
            return {
              data: [
                { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', supportedReasoningEfforts: [] },
                { id: 'gpt-4o', displayName: 'GPT-4o', supportedReasoningEfforts: [] },
              ],
            }
          }
          throw new Error(`Unexpected Codex app-server request: ${method}`)
        },
        async nextNotification() {
          return null
        },
        close() {},
      }
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://example.com/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch request: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Primary OpenAI Key',
            secret: 'sk-test-abcdef',
          }),
        }),
      )
      expect(saveSecret.status).toBe(200)
      const secret = await saveSecret.json()
      expect(secret.maskedSecret).toBe('sk-...cdef')

      const createProfile = await app.handle(
        new Request('http://localhost/profiles/profile-1', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Primary Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            credentialRef: secret.id,
          }),
        }),
      )
      expect(createProfile.status).toBe(200)
      const profile = await createProfile.json()
      expect(profile).toEqual(
        expect.objectContaining({
          id: 'profile-1',
          name: 'Primary Profile',
          providerKind: 'openai-compatible',
          credentialRef: secret.id,
        }),
      )

      const listProfiles = await app.handle(new Request('http://localhost/profiles'))
      expect(listProfiles.status).toBe(200)
      expect(await listProfiles.json()).toEqual([expect.objectContaining({ id: 'profile-1' })])

      const getProfile = await app.handle(new Request('http://localhost/profiles/profile-1'))
      expect(getProfile.status).toBe(200)
      expect(await getProfile.json()).toEqual(expect.objectContaining({ id: 'profile-1' }))

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: 'profile-1',
            providerKind: 'openai-compatible',
            label: 'Primary Profile',
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            secretRef: secret.id,
          }),
        }),
      )
      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({ id: 'gpt-4o', providerKind: 'openai-compatible' }),
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://example.com/v1/models',
      ).length
      expect(providerFetchCount).toBe(1)
      expect(codexClientOptions).toEqual([])

      const listSecrets = await app.handle(new Request('http://localhost/secrets'))
      expect(listSecrets.status).toBe(200)
      const secrets = await listSecrets.json()
      expect(secrets).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: secret.id, maskedSecret: 'sk-...cdef' }),
      ]))
      expect(JSON.stringify(secrets)).not.toContain('sk-test-abcdef')

      const deleteProfile = await app.handle(
        new Request('http://localhost/profiles/profile-1', { method: 'DELETE' }),
      )
      expect(deleteProfile.status).toBe(200)
      expect(await deleteProfile.json()).toEqual({ ok: true })

      const afterDelete = await app.handle(new Request('http://localhost/profiles/profile-1'))
      expect(afterDelete.status).toBe(404)

      const removeSecret = await app.handle(
        new Request(`http://localhost/secrets/${secret.id}`, {
          method: 'DELETE',
        }),
      )
      expect(removeSecret.status).toBe(200)
      expect(await removeSecret.json()).toEqual({ ok: true })
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('allows changing a manual profile provider kind and clears provider-kind-owned runtime state', async () => {
    const dataDir = makeTempDir('cradle-profile-kind-switch-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profile-kind-switch'

    try {
      const app = await createServerApp()
      const createProfile = await app.handle(
        new Request('http://localhost/profiles/profile-kind-switch', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Switch Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            credentialRef: null,
          }),
        }),
      )
      expect(createProfile.status).toBe(200)

      db()
        .update(providerTargets)
        .set({ enabledModelsJson: JSON.stringify(['gpt-4o']) })
        .where(eq(providerTargets.id, 'profile-kind-switch'))
        .run()
      db()
        .insert(providerTargetModelCache)
        .values({
          providerTargetId: 'profile-kind-switch',
          modelsJson: JSON.stringify([
            {
              id: 'gpt-4o',
              label: 'GPT-4o',
              providerKind: 'openai-compatible',
              capabilities: {},
            },
          ]),
          fetchedAt: 1,
        })
        .run()
      db()
        .insert(sessions)
        .values({
          id: 'session-kind-switch',
          workspaceId: null,
          title: 'Kind Switch Session',
          providerTargetId: 'profile-kind-switch',
          runtimeKind: 'standard',
          configJson: '{}',
        })
        .run()
      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-kind-switch',
          chatSessionId: 'session-kind-switch',
          providerTargetId: 'profile-kind-switch',
          runtimeKind: 'standard',
          requestedModelId: 'gpt-4o',
        })
        .run()

      const updateProfile = await app.handle(
        new Request('http://localhost/profiles/profile-kind-switch', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Switch Profile',
            providerKind: 'anthropic',
            enabled: true,
            config: { baseUrl: 'https://anthropic.example.com', model: 'claude-sonnet-4' },
            credentialRef: null,
          }),
        }),
      )
      expect(updateProfile.status).toBe(200)
      expect(await updateProfile.json()).toEqual(expect.objectContaining({
        id: 'profile-kind-switch',
        providerKind: 'anthropic',
      }))

      expect(
        db().select().from(providerTargets).where(eq(providerTargets.id, 'profile-kind-switch')).all(),
      ).toEqual([
        expect.objectContaining({
          providerKind: 'anthropic',
          enabledModelsJson: '[]',
        }),
      ])
      expect(
        db().select().from(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, 'profile-kind-switch')).all(),
      ).toEqual([])
      expect(
        db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, 'binding-kind-switch')).all(),
      ).toEqual([expect.objectContaining({ providerTargetId: null })])
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('keeps Volcengine profile config raw in model settings', async () => {
    const dataDir = makeTempDir('cradle-profile-endpoint-defaults-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profile-endpoint-defaults'

    try {
      const app = await createServerApp()
      const createProfile = await app.handle(
        new Request('http://localhost/profiles/profile-volcengine', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Volcengine Ark',
            providerKind: 'anthropic',
            enabled: true,
            config: {
              baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
              model: 'glm-5.2',
            },
            credentialRef: null,
          }),
        }),
      )
      expect(createProfile.status).toBe(200)
      const profile = ProfileResponseSchema.parse(await createProfile.json())

      expect(JSON.parse(profile.configJson)).toEqual({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
        model: 'glm-5.2',
      })

      const settingsRes = await app.handle(
        new Request('http://localhost/provider-targets/profile-volcengine/model-settings'),
      )
      expect(settingsRes.status).toBe(200)
      const settings = await settingsRes.json() as {
        connectionConfigJson: string
        configJson: string
      }
      expect(JSON.parse(settings.connectionConfigJson)).toEqual({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
        model: 'glm-5.2',
      })
      expect(JSON.parse(settings.configJson)).toEqual({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
        model: 'glm-5.2',
        enabledModels: [],
      })
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('keeps listing readable secret metadata when another credential cannot decrypt', async () => {
    const dataDir = makeTempDir('cradle-secret-list-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-list'

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'chatgpt-auth',
            label: 'ChatGPT Account',
            secret: JSON.stringify({
              kind: 'chatgpt-auth',
              chatgptAccountId: 'account-readable',
              chatgptPlanType: 'plus',
              updatedAt: 123,
            }),
          }),
        }),
      )
      expect(saveSecret.status).toBe(200)
      const secret = await saveSecret.json()

      db().insert(agentCredentials).values({
        id: 'broken-credential',
        kind: 'openai-compatible',
        label: 'Broken Credential',
        encryptedSecret: 'not-valid-ciphertext',
        createdAt: 1,
        updatedAt: 1,
      }).run()

      const listSecrets = await app.handle(new Request('http://localhost/secrets'))
      expect(listSecrets.status).toBe(200)
      expect(await listSecrets.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'broken-credential',
          maskedSecret: 'Unreadable credential',
          chatgpt: null,
        }),
        expect.objectContaining({
          id: secret.id,
          maskedSecret: 'ChatGPT accoun...able',
          chatgpt: {
            chatgptAccountId: 'account-readable',
            chatgptPlanType: 'plus',
            updatedAt: 123,
          },
        }),
      ]))
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('preserves chats and detaches runtime references when deleting a profile', async () => {
    const dataDir = makeTempDir('cradle-profile-delete-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profile-delete'

    try {
      const app = await createServerApp()
      const createProfile = await app.handle(
        new Request('http://localhost/profiles/profile-cleanup', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Cleanup Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o' },
            credentialRef: null,
          }),
        }),
      )
      expect(createProfile.status).toBe(200)

      db()
        .insert(agents)
        .values({
          id: 'agent-cleanup',
          name: 'Cleanup Agent',
          description: null,
          avatarUrl: null,
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'cleanup',
          providerTargetId: 'profile-cleanup',
          runtimeKind: 'standard',
          configJson: '{}',
          enabled: true,
        })
        .run()
      db()
        .insert(sessions)
        .values({
          id: 'session-agent-only-cleanup',
          workspaceId: null,
          title: 'Legacy Agent Session',
          providerTargetId: 'profile-cleanup',
          runtimeKind: 'standard',
          agentId: 'agent-cleanup',
          configJson: '{}',
        })
        .run()
      db()
        .insert(messages)
        .values({
          id: 'message-cleanup-user',
          sessionId: 'session-agent-only-cleanup',
          role: 'user',
          content: 'keep this chat',
          messageJson: JSON.stringify({ id: 'message-cleanup-user', role: 'user', parts: [] }),
        })
        .run()
      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-cleanup',
          chatSessionId: 'session-agent-only-cleanup',
          providerTargetId: 'profile-cleanup',
          runtimeKind: 'standard',
          requestedModelId: 'gpt-4o',
        })
        .run()
      db()
        .insert(usageLogs)
        .values({
          id: 'usage-cleanup',
          sessionId: 'session-agent-only-cleanup',
          messageId: 'message-cleanup-user',
          providerTargetId: 'profile-cleanup',
          modelId: 'gpt-4o',
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
        })
        .run()
      db()
        .insert(chatSessionQueueItems)
        .values({
          id: 'queue-cleanup',
          sessionId: 'session-agent-only-cleanup',
          mode: 'queue',
          status: 'pending',
          text: 'queued',
          providerTargetId: 'profile-cleanup',
          position: 0,
        })
        .run()
      db()
        .insert(backendCapabilitySnapshots)
        .values({
          id: 'capability-cleanup',
          providerTargetId: 'profile-cleanup',
          runtimeKind: 'standard',
          source: 'session_start',
          capabilitiesJson: '{}',
          recordedAt: 1,
        })
        .run()
      db()
        .insert(runtimeAuditLog)
        .values({
          providerTargetId: 'profile-cleanup',
          providerKind: 'openai-compatible',
          action: 'test',
          details: '{}',
        })
        .run()

      const deleteProfile = await app.handle(
        new Request('http://localhost/profiles/profile-cleanup', { method: 'DELETE' }),
      )
      expect(deleteProfile.status).toBe(200)
      expect(db().select().from(agents).where(eq(agents.id, 'agent-cleanup')).all()).toEqual([
        expect.objectContaining({
          id: 'agent-cleanup',
          enabled: false,
          providerTargetId: null,
        }),
      ])
      expect(db().select().from(sessions).where(eq(sessions.id, 'session-agent-only-cleanup')).all()).toEqual([
        expect.objectContaining({
          id: 'session-agent-only-cleanup',
          providerTargetId: null,
          agentId: 'agent-cleanup',
        }),
      ])
      expect(db().select().from(messages).where(eq(messages.id, 'message-cleanup-user')).all()).toEqual([
        expect.objectContaining({ content: 'keep this chat' }),
      ])
      expect(
        db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, 'binding-cleanup')).all(),
      ).toEqual([expect.objectContaining({ providerTargetId: null })])
      expect(db().select().from(usageLogs).where(eq(usageLogs.id, 'usage-cleanup')).all()).toEqual([
        expect.objectContaining({ providerTargetId: null }),
      ])
      expect(
        db().select().from(chatSessionQueueItems).where(eq(chatSessionQueueItems.id, 'queue-cleanup')).all(),
      ).toEqual([expect.objectContaining({ providerTargetId: null })])
      expect(
        db().select().from(backendCapabilitySnapshots).where(eq(backendCapabilitySnapshots.id, 'capability-cleanup')).all(),
      ).toEqual([expect.objectContaining({ providerTargetId: null })])
      expect(
        db().select().from(runtimeAuditLog).where(eq(runtimeAuditLog.action, 'test')).all(),
      ).toEqual([expect.objectContaining({ providerTargetId: null })])
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('returns structured errors for invalid input, missing profile, unavailable provider, and missing secret config', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_CREDENTIAL_SECRET

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const invalidProfile = await app.handle(
        new Request('http://localhost/profiles/profile-bad', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerKind: 'openai-compatible' }),
        }),
      )
      expect(invalidProfile.status).toBe(400)
      expect((await invalidProfile.json()).code).toBe('validation_error')

      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Missing Secret Config',
            secret: 'sk-test-abcdef',
          }),
        }),
      )
      expect(saveSecret.status).toBe(500)
      expect((await saveSecret.json()).code).toBe('secret_not_configured')

      process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-profiles'

      const invalidProviderKind = await app.handle(
        new Request('http://localhost/profiles/profile-unsupported', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Unsupported Profile',
            providerKind: 'cli-tui',
            enabled: true,
            config: {},
          }),
        }),
      )
      expect(invalidProviderKind.status).toBe(400)

      const invalidProviderBody = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerKind: 'openai-compatible' }),
        }),
      )
      expect(invalidProviderBody.status).toBe(400)
      expect((await invalidProviderBody.json()).code).toBe('validation_error')

      const unavailableProvider = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'not-a-real-provider',
            label: 'Unsupported Profile',
            config: {},
            secretRef: null,
          }),
        }),
      )
      expect(unavailableProvider.status).toBe(400)
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('stores Available Model registry mappings separately from custom models', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-model-mapping'

    setCodexChatgptModelListClientFactoryForTests(() => ({
      async initialize() {},
      async request(method) {
        if (method === 'model/list') {
          return {
            data: [{ id: 'vendor-gpt4o', displayName: 'Vendor GPT-4o', supportedReasoningEfforts: [] }],
          }
        }
        throw new Error(`Unexpected Codex app-server request: ${method}`)
      },
      async nextNotification() {
        return null
      },
      close() {},
    }))

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://example.com/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'vendor-gpt4o' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url === 'https://example.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'vendor-gpt4o' }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unexpected fetch request: ${url}`)
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const secretRes = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Mapped Key',
            secret: 'sk-map-test',
          }),
        }),
      )
      expect(secretRes.status).toBe(200)
      const secret = (await secretRes.json()) as { id: string }

      const profileRes = await app.handle(
        new Request('http://localhost/profiles/profile-map', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Mapped Profile',
            providerKind: 'openai-compatible',
            enabled: true,
            config: { baseUrl: 'https://example.com/v1' },
            credentialRef: secret.id,
          }),
        }),
      )
      expect(profileRes.status).toBe(200)

      const firstModelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: 'profile-map',
            providerKind: 'openai-compatible',
            label: 'Mapped Profile',
            config: { baseUrl: 'https://example.com/v1' },
            secretRef: secret.id,
          }),
        }),
      )
      expect(firstModelsRes.status).toBe(200)
      expect(await firstModelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'vendor-gpt4o',
          capabilities: expect.objectContaining({ registryMatch: 'unmatched' }),
        }),
      ])

      const mappingRes = await app.handle(
        new Request('http://localhost/model-registry/mappings/vendor-gpt4o', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: {
              id: 'gpt-4o',
              name: 'GPT-4o',
              limit: { context: 128000, output: 16384 },
              modalities: { input: ['text', 'image'], output: ['text'] },
              reasoning: false,
              tool_call: true,
            },
          }),
        }),
      )
      expect(mappingRes.status).toBe(200)
      expect(await mappingRes.json()).toEqual(expect.objectContaining({
        modelId: 'vendor-gpt4o',
        registryModelId: 'gpt-4o',
        model: expect.objectContaining({ id: 'gpt-4o', name: 'GPT-4o' }),
      }))

      const profileAfterMappingRes = await app.handle(
        new Request('http://localhost/profiles/profile-map'),
      )
      expect(profileAfterMappingRes.status).toBe(200)
      const profileAfterMapping = ProfileResponseSchema.parse(await profileAfterMappingRes.json())
      expect(profileAfterMapping.customModels).toBe('[]')
      const mappedModelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            profileId: 'profile-map',
            providerKind: 'openai-compatible',
            label: 'Mapped Profile',
            config: { baseUrl: 'https://example.com/v1' },
            secretRef: secret.id,
          }),
        }),
      )
      expect(mappedModelsRes.status).toBe(200)
      expect(await mappedModelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'vendor-gpt4o',
          label: 'GPT-4o',
          capabilities: expect.objectContaining({
            registryMatch: 'manual',
            registryModelId: 'gpt-4o',
            registryModelLabel: 'GPT-4o',
            contextWindow: 128000,
            maxOutput: 16384,
            toolCall: true,
          }),
        }),
      ])

      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://example.com/v1/models',
      ).length
      expect(providerFetchCount).toBe(2)
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('lists Anthropic models with the official default base URL and x-api-key auth', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-anthropic'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      expect(url).toBe('https://api.anthropic.com/v1/models')
      expect(init?.headers).toMatchObject({ 'x-api-key': 'sk-ant-test' })
      return new Response(
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'anthropic',
            label: 'Anthropic Key',
            secret: 'sk-ant-test',
          }),
        }),
      )
      expect(saveSecret.status).toBe(200)
      const secret = (await saveSecret.json()) as { id: string }

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'anthropic',
            label: 'Anthropic',
            config: {},
            secretRef: secret.id,
          }),
        }),
      )

      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
          providerKind: 'anthropic',
          capabilities: expect.objectContaining({
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
          }),
        }),
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://api.anthropic.com/v1/models',
      ).length
      expect(providerFetchCount).toBe(1)
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('lists Volcengine Anthropic models with bearer-token wire auth', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-anthropic-auth-token'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      expect(url).toBe('https://ark.cn-beijing.volces.com/api/coding/v1/models')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer ant-token-test' })
      expect(init?.headers).not.toMatchObject({ 'x-api-key': 'ant-token-test' })
      return new Response(
        JSON.stringify({
          data: [{ id: 'glm-5.2', display_name: 'GLM 5.2' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'anthropic',
            label: 'Anthropic API Key',
            secret: 'ant-token-test',
          }),
        }),
      )
      expect(saveSecret.status).toBe(200)
      const secret = (await saveSecret.json()) as { id: string }

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'anthropic',
            label: 'Volcengine Ark',
            config: { baseUrl: 'https://ark.cn-beijing.volces.com/api/coding' },
            secretRef: secret.id,
          }),
        }),
      )

      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'glm-5.2',
          label: 'GLM 5.2',
          providerKind: 'anthropic',
        }),
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://ark.cn-beijing.volces.com/api/coding/v1/models',
      ).length
      expect(providerFetchCount).toBe(1)
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('lists Anthropic models from a root base URL by probing /v1/models first', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret-for-root-anthropic'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url === MODELS_DEV_URL) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      expect(url).toBe('https://api.zhengmi.org/v1/models')
      expect(init?.headers).toMatchObject({
        'anthropic-version': '2023-06-01',
        'x-api-key': 'sk-ant-root',
      })
      return new Response(
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const saveSecret = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'anthropic',
            label: 'Root Anthropic Key',
            secret: 'sk-ant-root',
          }),
        }),
      )
      expect(saveSecret.status).toBe(200)
      const secret = (await saveSecret.json()) as { id: string }

      const modelsRes = await app.handle(
        new Request('http://localhost/providers/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            providerKind: 'anthropic',
            label: 'Root Anthropic',
            config: { baseUrl: 'https://api.zhengmi.org' },
            secretRef: secret.id,
          }),
        }),
      )

      expect(modelsRes.status).toBe(200)
      expect(await modelsRes.json()).toEqual([
        expect.objectContaining({
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
          providerKind: 'anthropic',
        }),
      ])
      const providerFetchCount = fetchSpy.mock.calls.filter(
        ([callInput]) => getRequestUrl(callInput) === 'https://api.zhengmi.org/v1/models',
      ).length
      expect(providerFetchCount).toBe(1)
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
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })
})
