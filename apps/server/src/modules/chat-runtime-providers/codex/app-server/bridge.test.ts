import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../../chat-runtime/runtime-provider-types'
import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import { CodexAppServerBridge } from './bridge'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './client'
import { codexChatSessionAppServerScopeId } from './host-lease'

afterEach(() => {
  providerRuntimeHostManager.clear()
})

class FakeBridgeAppServerClient {
  readonly pid = null
  readonly requests: Array<{ method: string, params?: unknown }> = []
  readonly skillExtraRootsRequests: unknown[] = []
  readonly unsupportedMethods = new Set<string>()
  close = vi.fn()
  initialize = vi.fn(async () => undefined)

  private readonly notifications: CodexAppServerMessage[] = []
  private readonly notificationWaiters: Array<(message: CodexAppServerMessage | null) => void> = []

  constructor(private readonly responseByMethod: Record<string, unknown> = {}) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    if (method === 'skills/extraRoots/set') {
      this.skillExtraRootsRequests.push(params)
      if (this.unsupportedMethods.has(method)) {
        throw new Error(`Invalid request: unknown variant \`${method}\`, expected one of \`initialize\`, \`turn/start\``)
      }
      return {}
    }
    this.requests.push({ method, params })
    if (this.unsupportedMethods.has(method)) {
      throw new Error(`Invalid request: unknown variant \`${method}\`, expected one of \`initialize\`, \`turn/start\``)
    }
    return this.responseByMethod[method] ?? {}
  }

  async nextNotification(signal?: AbortSignal): Promise<CodexAppServerMessage | null> {
    const next = this.notifications.shift()
    if (next) {
      return next
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error('aborted'))
      signal?.addEventListener('abort', onAbort, { once: true })
      this.notificationWaiters.push((message) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(message)
      })
    })
  }

  pushNotification(message: CodexAppServerMessage): void {
    const waiter = this.notificationWaiters.shift()
    if (waiter) {
      waiter(message)
      return
    }
    this.notifications.push(message)
  }
}

function createProfile(config: Record<string, unknown> = {}): RuntimeProviderTargetProfile {
  return {
    id: 'profile-codex',
    name: 'Codex',
    providerKind: 'openai-compatible',
    enabled: true,
    configJson: JSON.stringify({
      apiKey: 'sk-test',
      model: 'gpt-5-codex',
      ...config,
    }),
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-codex',
  }
}

function createRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: 'profile-codex',
    runtimeKind: 'codex',
    providerSessionId: 'codex-thread-1',
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: null },
    }),
  }
}

function createFakeChatgptJwt(input: {
  accountId: string
  planType?: string
  email?: string
  exp?: number
}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      'email': input.email ?? 'user@example.com',
      ...(input.exp !== undefined ? { exp: input.exp } : {}),
      'https://api.openai.com/auth': {
        chatgpt_account_id: input.accountId,
        chatgpt_plan_type: input.planType ?? 'plus',
      },
    }),
    'sig',
  ].join('.')
}

function createSecretMetadata(id: string, secret: string, kind = 'chatgpt-auth') {
  return {
    id,
    kind,
    label: 'Codex credential',
    secret,
  }
}

function createBridge(client: FakeBridgeAppServerClient): CodexAppServerBridge {
  return new CodexAppServerBridge({
    readSecret: () => 'sk-secret',
    resolveSkillPaths: () => ['/tmp/cradle-skill'],
    createAppServerClient: (_options: CodexAppServerClientOptions) => client,
  })
}

function createBridgeContext() {
  return {
    runtimeSession: createRuntimeSession(),
    profile: createProfile(),
    workspacePath: '/tmp/cradle-workspace',
  }
}

async function readSseEvents(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string, data: unknown }>> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) {
      break
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()
  return text
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n')
      const event = lines.find(line => line.startsWith('event: '))?.slice('event: '.length) ?? 'message'
      const dataLine = lines.find(line => line.startsWith('data: '))?.slice('data: '.length) ?? '{}'
      return { event, data: JSON.parse(dataLine) as unknown }
    })
}

describe('codexAppServerBridge stream lifecycle', () => {
  it('closes command exec streams after the method result', async () => {
    const client = new FakeBridgeAppServerClient({
      'command/exec': { exitCode: 0 },
    })
    const stream = createBridge(client).openEventStream({
      ...createBridgeContext(),
      method: 'command/exec',
      params: { command: 'pwd' },
    })

    const events = await readSseEvents(stream)

    expect(client.requests).toEqual([
      { method: 'command/exec', params: { command: 'pwd' } },
    ])
    expect(client.skillExtraRootsRequests).toEqual([{ extraRoots: ['/tmp/cradle-skill'] }])
    expect(events.map(event => event.event)).toEqual(['request_started', 'result', 'done'])
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('continues bridge calls when app-server does not support skill extra roots sync', async () => {
    const client = new FakeBridgeAppServerClient({
      'config/read': { config: { model: 'gpt-5-codex' } },
    })
    client.unsupportedMethods.add('skills/extraRoots/set')

    const result = await createBridge(client).invoke({
      ...createBridgeContext(),
      method: 'config/read',
      params: { cwd: '/tmp/cradle-workspace' },
    })

    expect(client.skillExtraRootsRequests).toEqual([{ extraRoots: ['/tmp/cradle-skill'] }])
    expect(client.requests).toEqual([
      { method: 'config/read', params: { cwd: '/tmp/cradle-workspace' } },
    ])
    expect(result.result).toEqual({ config: { model: 'gpt-5-codex' } })
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('keeps turn start streams open until the turn completion notification', async () => {
    const client = new FakeBridgeAppServerClient({
      'turn/start': { turn: { id: 'turn-1', status: 'inProgress' } },
    })
    const stream = createBridge(client).openEventStream({
      ...createBridgeContext(),
      method: 'turn/start',
      params: { threadId: 'codex-thread-1', input: [{ type: 'text', text: 'Hi' }] },
    })
    const eventsPromise = readSseEvents(stream)

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['turn/start'])
    })
    await Promise.resolve()
    expect(client.close).not.toHaveBeenCalled()

    client.pushNotification({
      method: 'turn/completed',
      params: { threadId: 'codex-thread-1', turn: { id: 'turn-1', status: 'completed' } },
    })

    const events = await eventsPromise
    expect(events.map(event => event.event)).toEqual(['request_started', 'result', 'notification', 'done'])
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('reuses one scoped host while bridge streams overlap for the same session', async () => {
    const appServerOptions: CodexAppServerClientOptions[] = []
    const clients: FakeBridgeAppServerClient[] = []
    const bridge = new CodexAppServerBridge({
      readSecret: () => 'sk-secret',
      resolveSkillPaths: () => ['/tmp/cradle-skill'],
      createAppServerClient: (options) => {
        appServerOptions.push(options)
        const client = new FakeBridgeAppServerClient({
          'turn/start': { turn: { id: 'turn-1', status: 'inProgress' } },
        })
        clients.push(client)
        return client
      },
    })

    const firstStream = bridge.openEventStream({
      ...createBridgeContext(),
      method: 'turn/start',
      params: { threadId: 'codex-thread-1', input: [{ type: 'text', text: 'First' }] },
    })
    const secondStream = bridge.openEventStream({
      ...createBridgeContext(),
      method: 'turn/start',
      params: { threadId: 'codex-thread-1', input: [{ type: 'text', text: 'Second' }] },
    })
    const firstEventsPromise = readSseEvents(firstStream)
    const secondEventsPromise = readSseEvents(secondStream)

    await vi.waitFor(() => {
      expect(clients[0]?.requests.map(request => request.method)).toEqual(['turn/start', 'turn/start'])
    })

    expect(appServerOptions).toHaveLength(1)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.initialize).toHaveBeenCalledOnce()
    expect(clients[0]!.close).not.toHaveBeenCalled()
    expect(providerRuntimeHostManager.listHosts()).toEqual([
      expect.objectContaining({
        runtimeKind: 'codex',
        providerTargetId: 'profile-codex',
        scopeId: codexChatSessionAppServerScopeId('chat-session-1'),
        refCount: 2,
        hasResource: true,
      }),
    ])

    clients[0]!.pushNotification({
      method: 'turn/completed',
      params: { threadId: 'codex-thread-1', turn: { id: 'turn-1', status: 'completed' } },
    })
    clients[0]!.pushNotification({
      method: 'turn/completed',
      params: { threadId: 'codex-thread-1', turn: { id: 'turn-2', status: 'completed' } },
    })

    const [firstEvents, secondEvents] = await Promise.all([firstEventsPromise, secondEventsPromise])
    expect(firstEvents.map(event => event.event)).toEqual(['request_started', 'result', 'notification', 'done'])
    expect(secondEvents.map(event => event.event)).toEqual(['request_started', 'result', 'notification', 'done'])
    expect(clients[0]!.close).toHaveBeenCalledOnce()
  })

  it('passes Cradle session context into bridge app-server clients', async () => {
    const appServerOptions: CodexAppServerClientOptions[] = []
    const client = new FakeBridgeAppServerClient({
      'config/read': { config: {} },
    })
    const bridge = new CodexAppServerBridge({
      readSecret: () => 'sk-secret',
      resolveSkillPaths: () => ['/tmp/cradle-skill'],
      createAppServerClient: (options) => {
        appServerOptions.push(options)
        return client
      },
    })

    await bridge.invoke({
      ...createBridgeContext(),
      workspaceId: 'workspace-1',
      method: 'config/read',
      params: { cwd: '/tmp/cradle-workspace' },
    })

    expect(appServerOptions[0]?.env).toEqual({
      CRADLE_CHAT_SESSION_ID: 'chat-session-1',
      CRADLE_WORKSPACE_ID: 'workspace-1',
      CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
      CRADLE_CODEX_API_KEY: 'sk-test',
      CODEX_API_KEY: 'sk-test',
      OPENAI_API_KEY: 'sk-test',
    })
  })

  it('uses ChatGPT auth with an OpenAI-compatible base URL without requiring an API key', async () => {
    const accessToken = createFakeChatgptJwt({ accountId: 'workspace-1', planType: 'plus' })
    const chatgptSecret = JSON.stringify({
      kind: 'chatgpt-auth',
      accessToken,
      refreshToken: 'refresh-token-1',
      chatgptAccountId: 'workspace-1',
      chatgptPlanType: 'plus',
    })
    const appServerOptions: CodexAppServerClientOptions[] = []
    const client = new FakeBridgeAppServerClient({
      'config/read': { config: {} },
    })
    const bridge = new CodexAppServerBridge({
      readSecret: () => chatgptSecret,
      readSecretValueWithMetadata: credentialRef => createSecretMetadata(credentialRef, chatgptSecret),
      resolveSkillPaths: () => ['/tmp/cradle-skill'],
      createAppServerClient: (options) => {
        appServerOptions.push(options)
        return client
      },
    })

    await bridge.invoke({
      ...createBridgeContext(),
      profile: {
        ...createProfile({
          apiKey: undefined,
          baseUrl: 'https://api.openai.com/v1',
        }),
        credentialRef: 'credential-chatgpt',
      },
      method: 'config/read',
      params: { cwd: '/tmp/cradle-workspace' },
    })

    expect(appServerOptions[0]?.apiKey).toBeUndefined()
    expect(appServerOptions[0]?.config).toEqual(expect.objectContaining({
      model_provider: 'cradle-openai-compatible',
      model_providers: {
        'cradle-openai-compatible': {
          name: 'Cradle OpenAI Compatible',
          base_url: 'https://api.openai.com/v1',
          wire_api: 'responses',
          requires_openai_auth: true,
        },
      },
    }))
    expect(client.requests).toEqual([
      {
        method: 'account/login/start',
        params: {
          type: 'chatgptAuthTokens',
          accessToken,
          chatgptAccountId: 'workspace-1',
          chatgptPlanType: 'plus',
        },
      },
      { method: 'config/read', params: { cwd: '/tmp/cradle-workspace' } },
    ])
  })
})
