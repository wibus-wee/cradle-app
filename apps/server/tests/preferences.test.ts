import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
import { setCodexChatgptCredentialLoginFetchForTests } from '../src/modules/chat-runtime-providers/codex/app-server/account-service'
import { setCodexChatgptModelListClientFactoryForTests } from '../src/modules/chat-runtime-providers/codex/app-server/model-list'
import { readSecret, saveSecret } from '../src/modules/secrets/service'
import {
  createClaudeGlobalNativeSkillProjectionTarget,
  createCodexGlobalNativeSkillProjectionTarget,
  projectNativeSkill,
  resetNativeSkillProjectionTargets,
} from '../src/modules/skills/native-skill-projection'
import { registerPluginSkill, resetPluginSkillRegistry } from '../src/plugins/skill-registry'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`
}

describe('preferences capability', () => {
  it('returns defaults when missing and persists app feature flags under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const initialRes = await app.handle(new Request('http://localhost/preferences/app'))
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        featureFlags: {
          multiWorkspacePoc: false,
          localAuthForDangerousActions: false,
          continueBlockedCodexGoals: false,
          blockCodexAppServerLogInserts: false,
          nativeProviderSkillProjection: false,
        },
        worktreeCleanup: {
          maxWorktrees: 25,
          maxTotalSizeGb: 50,
        },
      })

      const filePath = join(dataDir, 'preferences', 'app.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureFlags: {
            multiWorkspacePoc: true,
            localAuthForDangerousActions: true,
          },
        }),
      }))
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        featureFlags: {
          multiWorkspacePoc: true,
          localAuthForDangerousActions: true,
          continueBlockedCodexGoals: false,
          blockCodexAppServerLogInserts: false,
          nativeProviderSkillProjection: false,
        },
        worktreeCleanup: {
          maxWorktrees: 25,
          maxTotalSizeGb: 50,
        },
      })

      const finalRes = await app.handle(new Request('http://localhost/preferences/app'))
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        featureFlags: {
          multiWorkspacePoc: true,
          localAuthForDangerousActions: true,
          continueBlockedCodexGoals: false,
          blockCodexAppServerLogInserts: false,
          nativeProviderSkillProjection: false,
        },
        worktreeCleanup: {
          maxWorktrees: 25,
          maxTotalSizeGb: 50,
        },
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
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
    }
  })

  it('projects provider-native skills immediately when the app feature flag is enabled', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    const previousBuiltinSkillsDir = process.env.CRADLE_BUILTIN_SKILLS_DIR
    const builtinSkillsDir = join(dataDir, 'builtin-skills')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = dataDir
    process.env.CRADLE_BUILTIN_SKILLS_DIR = builtinSkillsDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()

      const pluginSkillDir = join(dataDir, 'plugin-skill')
      mkdirSync(pluginSkillDir, { recursive: true })
      writeFileSync(join(pluginSkillDir, 'SKILL.md'), [
        '---',
        'name: native-enable-plugin-demo',
        'description: Native enable plugin demo',
        '---',
        '',
        '# Native Enable Plugin Demo',
      ].join('\n'))
      registerPluginSkill('@cradle/native-enable-demo', {
        name: 'native-enable-plugin-demo',
        description: 'Native enable plugin demo',
        skillFile: join(pluginSkillDir, 'SKILL.md'),
      })

      const builtinSkillDir = join(builtinSkillsDir, 'native-enable-builtin-demo')
      mkdirSync(builtinSkillDir, { recursive: true })
      writeFileSync(join(builtinSkillDir, 'SKILL.md'), [
        '---',
        'name: native-enable-builtin-demo',
        'description: Native enable builtin demo',
        '---',
        '',
        '# Native Enable Builtin Demo',
      ].join('\n'))

      const enableRes = await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureFlags: {
            multiWorkspacePoc: false,
            localAuthForDangerousActions: false,
            continueBlockedCodexGoals: false,
            blockCodexAppServerLogInserts: false,
            nativeProviderSkillProjection: true,
          },
        }),
      }))

      expect(enableRes.status).toBe(200)
      const expectedProjectionPaths = [
        join(dataDir, '.codex', 'skills', 'cradle', 'plugin-native-enable-plugin-demo', 'SKILL.md'),
        join(dataDir, '.codex', 'skills', 'cradle', 'native-enable-builtin-demo', 'SKILL.md'),
        join(dataDir, '.claude', 'skills', 'cradle-plugin-native-enable-plugin-demo', 'SKILL.md'),
        join(dataDir, '.claude', 'skills', 'cradle-native-enable-builtin-demo', 'SKILL.md'),
      ]
      for (const projectionPath of expectedProjectionPaths) {
        expect(existsSync(projectionPath)).toBe(true)
      }
    }
    finally {
      resetPluginSkillRegistry()
      resetNativeSkillProjectionTargets()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
      if (previousBuiltinSkillsDir === undefined) {
        delete process.env.CRADLE_BUILTIN_SKILLS_DIR
      }
      else {
        process.env.CRADLE_BUILTIN_SKILLS_DIR = previousBuiltinSkillsDir
      }
    }
  })

  it('removes provider-native skill projections when the app feature flag is disabled', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      const skillDir = join(dataDir, 'source-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        'name: native-cleanup-demo',
        'description: Native cleanup demo',
        '---',
        '',
        '# Native Cleanup Demo',
      ].join('\n'))

      const source = {
        sourceKind: 'plugin' as const,
        skillName: 'native-cleanup-demo',
        skillFile: join(skillDir, 'SKILL.md'),
      }
      const codexProjection = projectNativeSkill(createCodexGlobalNativeSkillProjectionTarget(dataDir), source)
      const claudeProjection = projectNativeSkill(createClaudeGlobalNativeSkillProjectionTarget(dataDir), source)
      expect(existsSync(codexProjection)).toBe(true)
      expect(existsSync(claudeProjection)).toBe(true)

      app = await createServerApp()
      const disableRes = await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureFlags: {
            multiWorkspacePoc: false,
            localAuthForDangerousActions: false,
            continueBlockedCodexGoals: false,
            blockCodexAppServerLogInserts: false,
            nativeProviderSkillProjection: false,
          },
        }),
      }))

      expect(disableRes.status).toBe(200)
      expect(existsSync(codexProjection)).toBe(false)
      expect(existsSync(claudeProjection)).toBe(false)
    }
    finally {
      resetNativeSkillProjectionTargets()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
    }
  })

  it('applies and removes the Codex app-server log insert blocker trigger from the app feature flag', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      const logsPath = join(dataDir, 'runtimes', 'codex-app-server', 'logs_2.sqlite')
      mkdirSync(join(dataDir, 'runtimes', 'codex-app-server'), { recursive: true })
      const setupDb = new Database(logsPath)
      setupDb.exec('CREATE TABLE logs (id INTEGER PRIMARY KEY, message TEXT)')
      setupDb.close()

      app = await createServerApp()
      const enableRes = await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureFlags: {
            multiWorkspacePoc: false,
            blockCodexAppServerLogInserts: true,
          },
        }),
      }))
      expect(enableRes.status).toBe(200)

      const enabledDb = new Database(logsPath)
      enabledDb.prepare('INSERT INTO logs (message) VALUES (?)').run('blocked')
      expect(enabledDb.prepare('SELECT count(*) AS count FROM logs').get()).toEqual({ count: 0 })
      expect(enabledDb.prepare(
        'SELECT name FROM sqlite_master WHERE type = \'trigger\' AND name = \'block_log_inserts\'',
      ).get()).toEqual({ name: 'block_log_inserts' })
      enabledDb.close()

      const disableRes = await app.handle(new Request('http://localhost/preferences/app', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureFlags: {
            multiWorkspacePoc: false,
            blockCodexAppServerLogInserts: false,
          },
        }),
      }))
      expect(disableRes.status).toBe(200)

      const disabledDb = new Database(logsPath)
      disabledDb.prepare('INSERT INTO logs (message) VALUES (?)').run('allowed')
      expect(disabledDb.prepare('SELECT count(*) AS count FROM logs').get()).toEqual({ count: 1 })
      expect(disabledDb.prepare(
        'SELECT name FROM sqlite_master WHERE type = \'trigger\' AND name = \'block_log_inserts\'',
      ).get()).toBeUndefined()
      disabledDb.close()
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
    }
  })

  it('returns defaults when missing and persists chat preferences under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const initialRes = await app.handle(new Request('http://localhost/preferences/chat'))
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        modelId: null,
        configSelections: {},
        continuationBehavior: 'queue',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
      })

      const filePath = join(dataDir, 'preferences', 'chat.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 'gpt-4o-mini',
          configSelections: {
            reasoningEffort: 'high',
            webSearch: true,
          },
          continuationBehavior: 'steer',
        }),
      }))
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
        continuationBehavior: 'steer',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
      })

      const finalRes = await app.handle(new Request('http://localhost/preferences/chat'))
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        modelId: 'gpt-4o-mini',
        configSelections: {
          reasoningEffort: 'high',
          webSearch: true,
        },
        continuationBehavior: 'steer',
        titleGeneration: {
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'minimal',
        },
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
    }
  })

  it('returns defaults when missing and persists Codex preferences under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const initialRes = await app.handle(new Request('http://localhost/preferences/codex'))
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        useCradleUserAgent: true,
      })

      const filePath = join(dataDir, 'preferences', 'codex.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await app.handle(new Request('http://localhost/preferences/codex', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useCradleUserAgent: false,
        }),
      }))
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        useCradleUserAgent: false,
      })

      const finalRes = await app.handle(new Request('http://localhost/preferences/codex'))
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        useCradleUserAgent: false,
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
    }
  })

  it('creates independent ChatGPT auth credentials for provider targets', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret'
    const accessToken = makeJwt({
      'email': 'user@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-1',
        chatgpt_plan_type: 'plus',
      },
    })
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input)
      if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }))
        expect(JSON.parse(String(init?.body))).toEqual({
          client_id: expect.any(String),
        })
        return new Response(JSON.stringify({
          device_auth_id: 'device-auth-1',
          user_code: 'ABCD-EFGH',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          interval: '1',
        }))
      }
      if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }))
        expect(JSON.parse(String(init?.body))).toEqual({
          client_id: expect.any(String),
          device_auth_id: 'device-auth-1',
          user_code: 'ABCD-EFGH',
        })
        return new Response(JSON.stringify({
          authorization_code: 'authorization-code-1',
          code_verifier: 'code-verifier-1',
        }))
      }
      if (url === 'https://auth.openai.com/oauth/token') {
        const body = String(init?.body)
        expect(body).toContain('grant_type=authorization_code')
        expect(body).toContain('code=authorization-code-1')
        expect(body).toContain('redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback')
        expect(body).toContain('code_verifier=code-verifier-1')
        return new Response(JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-token-1',
        }))
      }
      return new Response(JSON.stringify({ error: 'unexpected_url', url }), { status: 500 })
    }) as typeof fetch
    setCodexChatgptCredentialLoginFetchForTests(fetchMock)
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const loginRes = await app.handle(new Request('http://localhost/provider-targets/credentials/chatgpt/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Work ChatGPT' }),
      }))
      expect(loginRes.status).toBe(200)
      const login = await loginRes.json() as { loginId: string }
      expect(login).toEqual(expect.objectContaining({
        loginId: expect.any(String),
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-EFGH',
        expiresAt: expect.any(Number),
      }))

      const pendingRes = await app.handle(new Request(`http://localhost/provider-targets/credentials/chatgpt/login/${login.loginId}`))
      expect(pendingRes.status).toBe(200)
      expect(await pendingRes.json()).toEqual(expect.objectContaining({
        state: 'pending',
        credentialRef: null,
      }))

      let credentialRef: string | null = null
      await vi.waitFor(async () => {
        const statusRes = await app!.handle(new Request(`http://localhost/provider-targets/credentials/chatgpt/login/${login.loginId}`))
        expect(statusRes.status).toBe(200)
        const status = await statusRes.json() as { state: string, credentialRef: string | null }
        expect(status).toEqual(expect.objectContaining({
          state: 'completed',
          email: 'user@example.com',
          credentialRef: expect.any(String),
        }))
        credentialRef = status.credentialRef
      })

      expect(credentialRef).toEqual(expect.any(String))
      expect(existsSync(join(dataDir, 'preferences', 'codex.json'))).toBe(false)
      expect(JSON.parse(readSecret(credentialRef!))).toEqual(expect.objectContaining({
        kind: 'chatgpt-auth',
        accessToken,
        refreshToken: 'refresh-token-1',
        chatgptAccountId: 'account-1',
        chatgptPlanType: 'plus',
      }))

      const codexRequests: Array<{ method: string, params?: unknown }> = []
      const codexClientOptions: Array<{ config?: Record<string, unknown> } | undefined> = []
      setCodexChatgptModelListClientFactoryForTests((options) => {
        codexClientOptions.push(options)
        return {
          initialize: vi.fn(async () => undefined),
          request: vi.fn(async (method: string, params?: unknown) => {
            codexRequests.push({ method, params })
            if (method === 'account/login/start') {
              return {}
            }
            if (method === 'model/list') {
              return {
                data: [
                  {
                    id: 'gpt-5-codex',
                    model: 'gpt-5-codex',
                    displayName: 'GPT-5 Codex',
                    supportedReasoningEfforts: [
                      { reasoningEffort: 'medium', description: 'Medium' },
                      { reasoningEffort: 'high', description: 'High' },
                    ],
                    inputModalities: ['text'],
                  },
                ],
                nextCursor: null,
              }
            }
            throw new Error(`unexpected Codex app-server method ${method}`)
          }),
          nextNotification: vi.fn(async () => null),
          close: vi.fn(),
        }
      })
      const profileRes = await app.handle(new Request('http://localhost/profiles/provider-chatgpt', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Work ChatGPT',
          providerKind: 'openai-compatible',
          enabled: true,
          config: { baseUrl: 'https://api.openai.com/v1' },
          credentialRef,
        }),
      }))
      expect(profileRes.status).toBe(200)
      const profileJson = await profileRes.json() as { configJson: string }
      expect(JSON.parse(profileJson.configJson)).toEqual({
        baseUrl: 'https://api.openai.com/v1',
        authMode: 'chatgptAuthTokens',
      })
      const modelsRes = await app.handle(new Request('http://localhost/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerKind: 'openai-compatible',
          label: 'Work ChatGPT',
          config: { baseUrl: 'https://api.openai.com/v1' },
          secretRef: credentialRef,
          profileId: 'provider-chatgpt',
          providerTargetKind: 'manual',
          providerTargetId: 'provider-chatgpt',
        }),
      }))
      const modelsJson = await modelsRes.json()
      expect(modelsRes.status, JSON.stringify(modelsJson)).toBe(200)
      expect(modelsJson).toEqual([
        expect.objectContaining({
          id: 'gpt-5-codex',
          providerKind: 'openai-compatible',
        }),
      ])
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining('/v1/models'),
        expect.anything(),
      )
      expect(codexClientOptions[0]?.config).toEqual({
        model_provider: 'cradle-openai-compatible',
        model_providers: {
          'cradle-openai-compatible': {
            name: 'Cradle OpenAI Compatible',
            base_url: 'https://api.openai.com/v1',
            wire_api: 'responses',
            requires_openai_auth: true,
          },
        },
      })
      expect(codexRequests.map(request => request.method)).toEqual(['account/login/start', 'model/list'])
    }
    finally {
      setCodexChatgptCredentialLoginFetchForTests(null)
      setCodexChatgptModelListClientFactoryForTests(null)
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
    }
  })

  it('reports expired ChatGPT auth during model refresh without an unhandled server error', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret'
    const expiredAccessToken = makeJwt({
      'exp': Math.floor(Date.now() / 1000) - 60,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-expired',
        chatgpt_plan_type: 'plus',
      },
    })
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input) === 'https://auth.openai.com/oauth/token') {
        return new Response(JSON.stringify({
          error: {
            message: 'Your refresh token has been invalidated. Please try signing in again.',
            type: 'invalid_request_error',
            code: 'refresh_token_invalidated',
          },
        }), { status: 401 })
      }
      return new Response(JSON.stringify({ error: 'unexpected_url', url: String(input) }), { status: 500 })
    }) as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const credential = saveSecret({
        kind: 'chatgpt-auth',
        label: 'Expired ChatGPT',
        secret: JSON.stringify({
          kind: 'chatgpt-auth',
          accessToken: expiredAccessToken,
          refreshToken: 'invalidated-refresh-token',
          chatgptAccountId: 'account-expired',
          chatgptPlanType: 'plus',
        }),
      })
      const profileRes = await app.handle(new Request('http://localhost/profiles/provider-chatgpt-expired', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Expired ChatGPT',
          providerKind: 'openai-compatible',
          enabled: true,
          config: {},
          credentialRef: credential.id,
        }),
      }))
      expect(profileRes.status).toBe(200)

      const modelsRes = await app.handle(new Request('http://localhost/providers/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerKind: 'openai-compatible',
          label: 'Expired ChatGPT',
          config: {},
          secretRef: credential.id,
          profileId: 'provider-chatgpt-expired',
          providerTargetKind: 'manual',
          providerTargetId: 'provider-chatgpt-expired',
        }),
      }))
      expect(modelsRes.status).toBe(401)
      expect(await modelsRes.json()).toEqual({
        code: 'codex_chatgpt_auth_reauth_required',
        message: 'ChatGPT sign-in expired. Please sign in again.',
        details: { providerKind: 'openai-compatible' },
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://auth.openai.com/oauth/token',
        expect.objectContaining({ method: 'POST' }),
      )
    }
    finally {
      vi.unstubAllGlobals()
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
    }
  })

  it('normalizes Codex PAT and Bedrock provider-target auth modes from credential kind', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'test-secret'
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const patCredential = saveSecret({
        kind: 'codex-personal-access-token',
        label: 'Codex PAT',
        secret: 'pat-token-1',
      })
      const bedrockCredential = saveSecret({
        kind: 'codex-bedrock-api-key',
        label: 'Codex Bedrock',
        secret: 'bedrock-token-1',
      })

      const patRes = await app.handle(new Request('http://localhost/provider-targets/codex-pat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Codex PAT',
          providerKind: 'openai-compatible',
          enabled: true,
          connectionConfig: {
            authMode: 'apikey',
            model: 'gpt-5-codex',
          },
          credentialRef: patCredential.id,
        }),
      }))
      expect(patRes.status).toBe(200)
      const patTarget = await patRes.json() as { connectionConfigJson: string, credentialRef: string }
      expect(patTarget.credentialRef).toBe(patCredential.id)
      expect(JSON.parse(patTarget.connectionConfigJson)).toEqual({
        authMode: 'personalAccessToken',
        model: 'gpt-5-codex',
      })
      expect(patTarget.connectionConfigJson).not.toContain('pat-token-1')

      const bedrockRes = await app.handle(new Request('http://localhost/provider-targets/codex-bedrock', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Codex Bedrock',
          providerKind: 'openai-compatible',
          enabled: true,
          connectionConfig: {
            authMode: 'apikey',
            model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            bedrock: {
              region: 'us-west-2',
            },
          },
          credentialRef: bedrockCredential.id,
        }),
      }))
      expect(bedrockRes.status).toBe(200)
      const bedrockTarget = await bedrockRes.json() as { connectionConfigJson: string, credentialRef: string }
      expect(bedrockTarget.credentialRef).toBe(bedrockCredential.id)
      expect(JSON.parse(bedrockTarget.connectionConfigJson)).toEqual({
        authMode: 'bedrockApiKey',
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        bedrock: {
          region: 'us-west-2',
        },
      })
      expect(bedrockTarget.connectionConfigJson).not.toContain('bedrock-token-1')
      expect(readSecret(patCredential.id)).toBe('pat-token-1')
      expect(readSecret(bedrockCredential.id)).toBe('bedrock-token-1')
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
      if (previousCredentialSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousCredentialSecret
      }
    }
  })

  it('returns defaults when missing and persists Desktop preferences under the server data directory', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const initialRes = await app.handle(new Request('http://localhost/preferences/desktop'))
      expect(initialRes.status).toBe(200)
      expect(await initialRes.json()).toEqual({
        requireDoubleCommandQToQuit: true,
        appshotHotkeyEnabled: true,
        appshotHotkeyTrigger: 'DoubleCommand',
        autoCheckForUpdates: true,
        autoDownloadUpdates: false,
        lastSeenChangelogVersion: null,
        externalTerminalApp: null,
      })

      const filePath = join(dataDir, 'preferences', 'desktop.json')
      expect(existsSync(filePath)).toBe(false)

      const saveRes = await app.handle(new Request('http://localhost/preferences/desktop', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requireDoubleCommandQToQuit: false,
          appshotHotkeyEnabled: false,
          appshotHotkeyTrigger: 'DoubleShift',
          autoCheckForUpdates: false,
          autoDownloadUpdates: true,
        }),
      }))
      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({ ok: true })

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
        requireDoubleCommandQToQuit: false,
        appshotHotkeyEnabled: false,
        appshotHotkeyTrigger: 'DoubleShift',
        autoCheckForUpdates: false,
        autoDownloadUpdates: true,
        lastSeenChangelogVersion: null,
        externalTerminalApp: null,
      })

      const finalRes = await app.handle(new Request('http://localhost/preferences/desktop'))
      expect(finalRes.status).toBe(200)
      expect(await finalRes.json()).toEqual({
        requireDoubleCommandQToQuit: false,
        appshotHotkeyEnabled: false,
        appshotHotkeyTrigger: 'DoubleShift',
        autoCheckForUpdates: false,
        autoDownloadUpdates: true,
        lastSeenChangelogVersion: null,
        externalTerminalApp: null,
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
    }
  })

  it('returns structured errors for invalid payloads', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const invalidModel = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: 123,
          configSelections: {},
          continuationBehavior: 'queue',
        }),
      }))
      expect(invalidModel.status).toBe(400)
      expect((await invalidModel.json()).code).toBe('validation_error')

      const invalidSelections = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: null,
          configSelections: {
            bad: { nested: true },
          },
          continuationBehavior: 'queue',
        }),
      }))
      expect(invalidSelections.status).toBe(400)
      expect((await invalidSelections.json()).code).toBe('validation_error')

      const invalidContinuationBehavior = await app.handle(new Request('http://localhost/preferences/chat', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: null,
          configSelections: {},
          continuationBehavior: 'interrupt',
        }),
      }))
      expect(invalidContinuationBehavior.status).toBe(400)
      expect((await invalidContinuationBehavior.json()).code).toBe('validation_error')

      const invalidCodexPreferences = await app.handle(new Request('http://localhost/preferences/codex', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          useCradleUserAgent: 'false',
        }),
      }))
      expect(invalidCodexPreferences.status).toBe(400)
      expect((await invalidCodexPreferences.json()).code).toBe('validation_error')

      const invalidDesktopPreferences = await app.handle(new Request('http://localhost/preferences/desktop', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requireDoubleCommandQToQuit: 'true',
        }),
      }))
      expect(invalidDesktopPreferences.status).toBe(400)
      expect((await invalidDesktopPreferences.json()).code).toBe('validation_error')
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
    }
  })
})
