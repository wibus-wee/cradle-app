import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { addHostMcpServer, removeHostMcpServer } from '../src/plugins/mcp-registry'

const sdkMocks = vi.hoisted(() => ({
  claudeQuery: vi.fn(),
  getSubagentMessages: vi.fn(),
  getSessionInfo: vi.fn(),
  listSubagents: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  getSubagentMessages: sdkMocks.getSubagentMessages,
  getSessionInfo: sdkMocks.getSessionInfo,
  listSubagents: sdkMocks.listSubagents,
  query: sdkMocks.claudeQuery,
}))

interface ChatMessageSnapshot {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  content: string
  parentToolCallId?: string | null
  message: {
    parts: UIMessage['parts']
  }
}

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function makeAsyncSequence<T>(items: T[]) {
  let index = 0
  let done = false
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (done || index >= items.length) {
        return { done: true as const, value: undefined }
      }
      const value = items[index]
      index += 1
      return { done: false as const, value }
    },
    async return() {
      done = true
      return { done: true as const, value: undefined }
    },
  }
}

async function waitForMessageStatus(app: ElysiaApp, sessionId: string, expectedStatus: ChatMessageSnapshot['status']): Promise<ChatMessageSnapshot[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`))
    if (response.status === 200) {
      const { rows: groups } = await response.json() as { revision: number, rows: ChatMessageSnapshot[] }
      const assistant = groups.find(group => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for assistant status ${expectedStatus}`)
}

async function collectSseChunks(response: Response): Promise<UIMessageChunk[]> {
  const payload = await response.text()
  return payload
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('data: '))
    .flatMap((block) => {
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length))
        .join('\n')
      if (data === '[DONE]') {
        return []
      }
      return [JSON.parse(data) as UIMessageChunk]
    })
}

function isToolPartFor(part: UIMessage['parts'][number], toolCallId: string): boolean {
  return part.type.startsWith('tool-') && 'toolCallId' in part && part.toolCallId === toolCallId
}

async function createProfileAndSession(app: ElysiaApp, input: {
  workspaceId: string
  providerKind: 'claude-agent' | 'codex'
  profileId: string
  sessionId: string
  config: Record<string, unknown>
  secret: string
}) {
  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: input.providerKind,
      label: `${input.providerKind} key`,
      secret: input.secret,
    }),
  }))
  expect(credentialRes.status).toBe(200)
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await app.handle(new Request(`http://localhost/profiles/${input.profileId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: input.profileId,
      providerKind: input.providerKind === 'claude-agent' ? 'anthropic' : 'openai-compatible',
      enabled: true,
      config: input.config,
      credentialRef: credential.id,
    }),
  }))
  expect(profileRes.status).toBe(200)

  const sessionRes = await app.handle(new Request('http://localhost/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.sessionId,
      workspaceId: input.workspaceId,
      title: `${input.providerKind} session`,
      providerTargetId: input.profileId,
      runtimeKind: input.providerKind,
    }),
  }))
  expect(sessionRes.status).toBe(200)

  return { credentialRef: credential.id }
}

describe('sdk-backed providers in unified chat runtime', () => {
  beforeEach(() => {
    sdkMocks.claudeQuery.mockReset()
    sdkMocks.getSubagentMessages.mockReset()
    sdkMocks.getSessionInfo.mockReset()
    sdkMocks.getSessionInfo.mockResolvedValue(undefined)
    sdkMocks.listSubagents.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports claude-agent profiles in metadata endpoints and unified chat runs', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'
    removeHostMcpServer('browser-use')
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/tmp/browser-use-mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'stream_event',
        session_id: 'claude-session-1',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking' },
        },
      },
      {
        type: 'stream_event',
        session_id: 'claude-session-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Reasoning...' },
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          id: 'msg_1',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Claude says hi' }],
          usage: { input_tokens: 9, output_tokens: 4 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-1',
        usage: { input_tokens: 9, output_tokens: 4 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-sdk',
        name: 'Workspace SDK',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-sdk',
        providerKind: 'claude-agent',
        profileId: 'profile-claude',
        sessionId: 'session-claude',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-123',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Claude' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Reasoning...' }),
        expect.objectContaining({ type: 'text', text: 'Claude says hi', state: 'done' }),
      ]))

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-claude'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(expect.objectContaining({
        promptTokens: 9,
        completionTokens: 4,
        totalTokens: 13,
      }))
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
    }
  })

  it('applies Claude Agent SDK model aliases from agent settings to chat runs', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-agent-settings-session',
        message: {
          id: 'msg_2',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Agent configured' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-agent-settings-session',
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ]))

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-agent-settings',
        name: 'Workspace Agent Settings',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      const credentialRes = await app.handle(new Request('http://localhost/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'anthropic',
          label: 'Anthropic key',
          secret: 'sk-ant-agent-settings',
        }),
      }))
      expect(credentialRes.status).toBe(200)
      const credential = await credentialRes.json() as { id: string }

      const profileRes = await app.handle(new Request('http://localhost/profiles/profile-agent-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Anthropic',
          providerKind: 'anthropic',
          enabled: true,
          config: { model: 'claude-sonnet-4-20250514' },
          credentialRef: credential.id,
        }),
      }))
      expect(profileRes.status).toBe(200)

      const agentRes = await app.handle(new Request('http://localhost/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Claude Alias Agent',
          avatarStyle: 'bottts-neutral',
          avatarSeed: 'alias-seed',
          providerTargetId: 'profile-agent-settings',
          modelId: 'claude-sonnet-4-20250514',
          runtimeKind: 'claude-agent',
          configJson: JSON.stringify({
            claudeAgent: {
              modelAliases: {
                haiku: 'claude-haiku-4-5',
                sonnet: 'claude-sonnet-4-5',
                opus: 'claude-opus-4-5',
              },
            },
          }),
        }),
      }))
      expect(agentRes.status).toBe(200)
      const agent = await agentRes.json() as { id: string }

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'session-agent-settings',
          workspaceId: 'workspace-agent-settings',
          title: 'Agent settings session',
          agentId: agent.id,
        }),
      }))
      expect(sessionRes.status).toBe(200)

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-agent-settings/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Use agent settings' }),
      }))
      expect(runRes.status).toBe(200)

      await waitForMessageStatus(app, 'session-agent-settings', 'complete')

      const call = sdkMocks.claudeQuery.mock.calls[0]?.[0] as {
        options?: { env?: Record<string, string> }
      } | undefined
      expect(call?.options?.env).toEqual(expect.objectContaining({
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5',
      }))
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
    }
  })

  it('applies Claude Agent SDK model aliases from chat session runtime settings to chat runs', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-session-matrix-session',
        message: {
          id: 'msg_3',
          model: 'claude-sonnet-main',
          content: [{ type: 'text', text: 'Session configured' }],
          usage: { input_tokens: 4, output_tokens: 2 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-matrix-session',
        usage: { input_tokens: 4, output_tokens: 2 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-main', display_name: 'Claude Sonnet Main' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-session-matrix-settings',
        name: 'Workspace Session Matrix Settings',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-session-matrix-settings',
        providerKind: 'claude-agent',
        profileId: 'profile-session-matrix-settings',
        sessionId: 'session-session-matrix-settings',
        config: {
          model: 'claude-sonnet-main',
          claudeAgent: {
            modelAliases: {
              haiku: 'claude-haiku-provider',
              sonnet: 'claude-sonnet-provider',
              opus: 'claude-opus-provider',
            },
          },
        },
        secret: 'sk-ant-session-matrix-settings',
      })

      const patchRes = await app.handle(new Request('http://localhost/chat/sessions/session-session-matrix-settings/runtime-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claudeAgent: {
            modelAliases: {
              haiku: 'claude-haiku-session',
              sonnet: 'claude-sonnet-session',
              opus: 'claude-opus-session',
            },
          },
        }),
      }))
      expect(patchRes.status).toBe(200)

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-session-matrix-settings/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Use session settings' }),
      }))
      expect(runRes.status).toBe(200)

      await waitForMessageStatus(app, 'session-session-matrix-settings', 'complete')

      const call = sdkMocks.claudeQuery.mock.calls[0]?.[0] as {
        options?: { env?: Record<string, string> }
      } | undefined
      expect(call?.options?.env).toEqual(expect.objectContaining({
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-session',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-session',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-session',
      }))
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
    }
  })

  it('emits tool_call.started and tool_call.completed for claude-agent tool use lifecycle', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    // Mock a tool call flow: assistant emits tool_use → user sends tool_result → final text
    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-tool-session',
        message: {
          id: 'msg_4a',
          model: 'claude-sonnet-4-20250514',
          content: [
            { type: 'tool_use', id: 'toolu_abc123', name: 'bash', input: { command: 'echo hello' } },
          ],
          usage: { input_tokens: 10, output_tokens: 3 },
        },
      },
      {
        type: 'user',
        session_id: 'claude-tool-session',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'hello\n', is_error: false },
          ],
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-tool-session',
        message: {
          id: 'msg_4b',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Done running bash' }],
          usage: { input_tokens: 15, output_tokens: 5 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-tool-session',
        usage: { input_tokens: 20, output_tokens: 8 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-tool',
        name: 'Workspace Tool',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-tool',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-tool',
        sessionId: 'session-claude-tool',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-tool-test',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-tool/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run echo hello' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude-tool', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      const partTypes = assistant?.message.parts.map(part => part.type) ?? []

      expect(partTypes).toContain('tool-bash')
      expect(partTypes).toContain('text')

      const toolIdx = partTypes.indexOf('tool-bash')
      const textIdx = partTypes.indexOf('text')
      expect(toolIdx).toBeLessThan(textIdx)

      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-bash',
          toolCallId: 'toolu_abc123',
          state: 'output-available',
          output: expect.objectContaining({
            type: 'cradle.builtin-tool-call.result.v1',
            identifier: 'claude-code',
            apiName: 'Bash',
            result: 'hello\n',
          }),
        }),
        expect.objectContaining({ type: 'text', text: 'Done running bash', state: 'done' }),
      ]))
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
    }
  })

  it('keeps active subagent progress out of the parent stream and transcript', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-subagent-session',
        message: {
          id: 'msg_5a',
          model: 'claude-sonnet-4-20250514',
          content: [
            { type: 'text', text: 'Main task dispatch' },
            { type: 'tool_use', id: 'toolu_parent_1', name: 'task', input: { description: 'Investigate runtime' } },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
      {
        type: 'system',
        subtype: 'task_started',
        session_id: 'claude-subagent-session',
        uuid: 'task-started-1',
        task_id: 'task_sub_1',
        tool_use_id: 'toolu_parent_1',
        description: 'Investigate Agent',
      },
      {
        type: 'assistant',
        session_id: 'claude-subagent-session',
        parent_tool_use_id: 'toolu_parent_1',
        message: {
          id: 'msg_5b',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Subagent investigating' }],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-subagent-session',
        message: {
          id: 'msg_5c',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Main task finished' }],
          usage: { input_tokens: 15, output_tokens: 5 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-subagent-session',
        usage: { input_tokens: 21, output_tokens: 9 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-subagent',
        name: 'Workspace Subagent',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-subagent',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-subagent',
        sessionId: 'session-claude-subagent',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-subagent-test',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-subagent/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Dispatch a subagent' }),
      }))
      expect(runRes.status).toBe(200)

      const chunks = await collectSseChunks(runRes)
      expect(JSON.stringify(chunks)).not.toContain('Subagent investigating')
      expect(chunks.map(chunk => chunk.type)).toContain('finish')

      const timeline = await waitForMessageStatus(app, 'session-claude-subagent', 'complete')
      const assistantMessages = timeline.filter(message => message.role === 'assistant')
      expect(assistantMessages).toHaveLength(1)
      const assistant = assistantMessages[0]
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool-task', toolCallId: 'toolu_parent_1' }),
        expect.objectContaining({ type: 'text', text: 'Main task dispatch' }),
      ]))
      const toolPart = assistant?.message.parts.find(part =>
        isToolPartFor(part, 'toolu_parent_1'))
      expect(toolPart).toBeTruthy()
      expect(JSON.stringify(assistant?.message)).not.toContain('Subagent investigating')
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
    }
  })

  it('keeps late subagent lifecycle text out of the parent stream and transcript', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-subagent-late-task-session',
        message: {
          id: 'msg_6a',
          model: 'claude-sonnet-4-20250514',
          content: [
            { type: 'text', text: 'Dispatch late-task subagent' },
            { type: 'tool_use', id: 'toolu_parent_late', name: 'task', input: { description: 'Investigate late task metadata' } },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-subagent-late-task-session',
        parent_tool_use_id: 'toolu_parent_late',
        message: {
          id: 'msg_6b',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Working before task metadata arrives' }],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      },
      {
        type: 'system',
        subtype: 'task_notification',
        session_id: 'claude-subagent-late-task-session',
        uuid: 'task-notification-late',
        task_id: 'task_sub_late',
        tool_use_id: 'toolu_parent_late',
        status: 'completed',
        output_file: '/tmp/task_sub_late.json',
        summary: 'Late task completed',
      },
      {
        type: 'result',
        session_id: 'claude-subagent-late-task-session',
        usage: { input_tokens: 21, output_tokens: 9 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-subagent-late-task',
        name: 'Workspace Subagent Late Task',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-subagent-late-task',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-subagent-late-task',
        sessionId: 'session-claude-subagent-late-task',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-subagent-late-task',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-subagent-late-task/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Dispatch late task metadata subagent' }),
      }))
      expect(runRes.status).toBe(200)

      const chunks = await collectSseChunks(runRes)
      expect(JSON.stringify(chunks)).not.toContain('Working before task metadata arrives')
      expect(JSON.stringify(chunks)).not.toContain('Late task completed')

      const timeline = await waitForMessageStatus(app, 'session-claude-subagent-late-task', 'complete')
      const assistant = timeline.find(message => message.role === 'assistant')
      const toolPart = assistant?.message.parts.find(part =>
        isToolPartFor(part, 'toolu_parent_late'))
      expect(toolPart).toBeTruthy()
      expect(JSON.stringify(assistant?.message)).not.toContain('Working before task metadata arrives')
      expect(JSON.stringify(assistant?.message)).not.toContain('Late task completed')
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
    }
  })

  it('merges Claude subagent tool uses with later results in provider thread projection', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-subagent-split-session',
        message: {
          id: 'msg_7a',
          model: 'claude-sonnet-4-20250514',
          content: [
            { type: 'tool_use', id: 'call_parent_a', name: 'Agent', input: { description: 'Explore preferences', subagent_type: 'Explore' } },
          ],
          usage: { input_tokens: 10, output_tokens: 3 },
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-subagent-split-session',
        message: {
          id: 'msg_7b',
          model: 'claude-sonnet-4-20250514',
          content: [
            { type: 'tool_use', id: 'call_parent_b', name: 'Agent', input: { description: 'Explore diff-review', subagent_type: 'Explore' } },
          ],
          usage: { input_tokens: 10, output_tokens: 3 },
        },
      },
      {
        type: 'user',
        session_id: 'claude-subagent-split-session',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'call_parent_b', content: 'diff-review result', is_error: false },
          ],
        },
      },
      {
        type: 'user',
        session_id: 'claude-subagent-split-session',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'call_parent_a', content: 'preferences result', is_error: false },
          ],
        },
      },
      {
        type: 'result',
        session_id: 'claude-subagent-split-session',
        usage: { input_tokens: 21, output_tokens: 9 },
      },
    ]))
    sdkMocks.listSubagents.mockResolvedValue(['agent-explore'])
    sdkMocks.getSubagentMessages.mockResolvedValue([
      {
        type: 'assistant',
        uuid: 'subagent-tool-use-a',
        timestamp: '2026-07-04T01:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_child_a', name: 'Bash', input: { command: 'rg preferences apps/server/src/modules/preferences' } },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: 'subagent-tool-use-b',
        timestamp: '2026-07-04T01:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_child_b', name: 'Read', input: { file_path: '/Users/wibus/dev/cradle-app/apps/server/src/modules/diff-review/service.ts' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'subagent-tool-result-b',
        timestamp: '2026-07-04T01:00:02.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_child_b', content: 'service.ts contents', is_error: false },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'subagent-tool-result-a',
        timestamp: '2026-07-04T01:00:03.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_child_a', content: 'preferences/model.ts\npreferences/service.ts', is_error: false },
          ],
        },
      },
    ])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-subagent-split',
        name: 'Workspace Subagent Split',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-subagent-split',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-subagent-split',
        sessionId: 'session-claude-subagent-split',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-subagent-split',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-subagent-split/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Dispatch split subagents' }),
      }))
      expect(runRes.status).toBe(200)
      await collectSseChunks(runRes)
      await waitForMessageStatus(app, 'session-claude-subagent-split', 'complete')

      const threadRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-subagent-split/provider-threads/agent-explore/turns'))
      expect(threadRes.status).toBe(200)
      const projection = await threadRes.json() as { turns: Array<{ id: string, items: unknown[] }>, messages: UIMessage[] }
      expect(projection.messages).toHaveLength(2)
      expect(projection.turns).toHaveLength(2)

      const toolParts = projection.messages.map(message => message.parts[0])
      expect(toolParts).toEqual([
        expect.objectContaining({ type: 'tool-Bash', toolCallId: 'call_child_a', state: 'output-available' }),
        expect.objectContaining({ type: 'tool-Read', toolCallId: 'call_child_b', state: 'output-available' }),
      ])
      expect(JSON.stringify(toolParts[0])).toContain('preferences/model.ts')
      expect(JSON.stringify(toolParts[1])).toContain('service.ts contents')
      expect(projection.messages.flatMap(message => message.parts)).toHaveLength(2)
      expect(projection.turns.map(turn => turn.items)).toEqual([
        expect.arrayContaining([
          expect.objectContaining({ message: expect.objectContaining({ uuid: 'subagent-tool-use-a' }) }),
          expect.objectContaining({ message: expect.objectContaining({ uuid: 'subagent-tool-result-a' }) }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({ message: expect.objectContaining({ uuid: 'subagent-tool-use-b' }) }),
          expect.objectContaining({ message: expect.objectContaining({ uuid: 'subagent-tool-result-b' }) }),
        ]),
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
    }
  })

  it('emits tool_call.completed with error result for failed tool calls', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'sdk-provider-secret'

    sdkMocks.claudeQuery.mockImplementation(() => makeAsyncSequence([
      {
        type: 'assistant',
        session_id: 'claude-err-session',
        message: {
          id: 'msg_8a',
          model: 'claude-sonnet-4-20250514',
          content: [
            { type: 'tool_use', id: 'toolu_err456', name: 'bash', input: { command: 'false' } },
          ],
          usage: { input_tokens: 8, output_tokens: 2 },
        },
      },
      {
        type: 'user',
        session_id: 'claude-err-session',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_err456', content: 'exit code 1', is_error: true },
          ],
        },
      },
      {
        type: 'assistant',
        session_id: 'claude-err-session',
        message: {
          id: 'msg_8b',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Command failed' }],
          usage: { input_tokens: 12, output_tokens: 4 },
        },
      },
      {
        type: 'result',
        session_id: 'claude-err-session',
        usage: { input_tokens: 15, output_tokens: 5 },
      },
    ]))

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url === 'https://api.anthropic.com/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://models.dev/api.json') {
        return new Response(JSON.stringify({ anthropic: { models: {} } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-tool-err',
        name: 'Workspace Tool Err',
        locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
        path: workspaceRoot,
      }).run()

      await createProfileAndSession(app, {
        workspaceId: 'workspace-tool-err',
        providerKind: 'claude-agent',
        profileId: 'profile-claude-err',
        sessionId: 'session-claude-err',
        config: { model: 'claude-sonnet-4-20250514' },
        secret: 'sk-ant-err-test',
      })

      const runRes = await app.handle(new Request('http://localhost/chat/sessions/session-claude-err/response', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Run false command' }),
      }))
      expect(runRes.status).toBe(200)

      const timeline = await waitForMessageStatus(app, 'session-claude-err', 'complete')
      const assistant = timeline.find(group => group.role === 'assistant')
      expect(assistant?.message.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool-bash', toolCallId: 'toolu_err456', state: 'output-error', errorText: 'exit code 1' }),
      ]))
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
    }
  })
})

describe('claude-agent mapper: input_json_delta streaming', () => {
  it('maps subagent text as ordinary chunks while provider routing owns parent isolation', async () => {
    const { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper')

    const childState = createClaudeAgentChunkMapperState('child-text-1')

    const subagentResult = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'sess-1',
      parent_tool_use_id: 'toolu_parent',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Child text' }],
      },
    } as any, childState)

    expect(subagentResult.chunks).toEqual([
      { type: 'text-start', id: 'child-text-1' },
      { type: 'text-delta', id: 'child-text-1', delta: 'Child text' },
    ])
    expect(childState.assistantStarted).toBe(true)
    expect(childState.emittedTextByTextItemId.size).toBe(1)

    const parentState = createClaudeAgentChunkMapperState('parent-text-1')

    const parentDelta = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Parent text' },
      },
    } as any, parentState)

    expect(parentDelta.chunks).toEqual([
      { type: 'text-start', id: 'parent-text-1' },
      { type: 'text-delta', id: 'parent-text-1', delta: 'Parent text' },
    ])

    const parentSnapshot = await mapClaudeAgentMessageToChunks({
      type: 'assistant',
      session_id: 'sess-1',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Parent text' }],
      },
    } as any, parentState)

    expect(parentSnapshot.chunks).toEqual([])
  })

  it('maps content_block_delta with input_json_delta to tool-input-delta chunks', async () => {
    const { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper')

    const state = createClaudeAgentChunkMapperState('text-1')

    // 1. content_block_start for tool_use — should record the tool block ID
    const startResult = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_input_delta', name: 'bash', input: '' },
      },
    } as any, state)

    expect(startResult.chunks).toEqual([
      expect.objectContaining({ type: 'tool-input-start', toolCallId: 'toolu_input_delta', toolName: 'bash' }),
    ])
    expect(state.activeToolBlockIds.get(0)).toBe('toolu_input_delta')

    // 2. content_block_delta with input_json_delta — should emit tool-input-delta
    const delta1 = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command"' },
      },
    } as any, state)

    expect(delta1.chunks).toEqual([{
      type: 'tool-input-delta',
      toolCallId: 'toolu_input_delta',
      inputTextDelta: '{"command"',
    }])

    // 3. Second delta
    const delta2 = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: ':"echo hi"}' },
      },
    } as any, state)

    expect(delta2.chunks).toEqual([{
      type: 'tool-input-delta',
      toolCallId: 'toolu_input_delta',
      inputTextDelta: ':"echo hi"}',
    }])
  })

  it('ignores input_json_delta with empty partial_json', async () => {
    const { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper')

    const state = createClaudeAgentChunkMapperState('text-1')
    state.activeToolBlockIds.set(0, 'toolu_empty')

    const result = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
    } as any, state)

    expect(result.chunks).toEqual([])
  })

  it('ignores input_json_delta for unknown block index', async () => {
    const { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } = await import('../src/modules/chat-runtime-providers/claude-agent/event-to-chunk-mapper')

    const state = createClaudeAgentChunkMapperState('text-1')

    const result = await mapClaudeAgentMessageToChunks({
      type: 'stream_event',
      session_id: 'sess-1',
      event: {
        type: 'content_block_delta',
        index: 5,
        delta: { type: 'input_json_delta', partial_json: '{"data":"value"}' },
      },
    } as any, state)

    expect(result.chunks).toEqual([])
  })
})
