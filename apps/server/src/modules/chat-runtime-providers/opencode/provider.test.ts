import { describe, expect, it, vi } from 'vitest'

import type {
  AssistantMessage as OpencodeAssistantMessage,
  Event as OpencodeEvent,
  Part as OpencodePart,
  Permission as OpencodePermission,
} from '@opencode-ai/sdk'
import type {
  RuntimeSession,
  RuntimeToolApprovalRequest,
  RuntimeToolApprovalResolution,
} from '../../chat-runtime/runtime-provider-types'
import type { OpencodeRuntimeResource } from './runtime-context'
import { formatOpencodeAssistantError, OpencodeProvider } from './provider'

type OpencodeAssistantError = NonNullable<OpencodeAssistantMessage['error']>

class AsyncEventStream<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.values.length > 0) {
          return { value: this.values.shift()!, done: false }
        }
        if (this.closed) {
          return { value: undefined, done: true }
        }
        return await new Promise<IteratorResult<T>>(resolve => this.waiters.push(resolve))
      },
    }
  }
}

function createRuntimeSession(resource: OpencodeRuntimeResource): RuntimeSession {
  return {
    id: 'chat-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: null,
    runtimeKind: 'opencode',
    providerSessionId: 'ses_1',
    providerRuntimeLease: {
      resource,
      refresh() {},
      release() {},
    },
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/workspace',
      models: { currentModelId: 'openai/gpt-5' },
    }),
  }
}

function assistantMessage(input: Partial<OpencodeAssistantMessage> = {}): OpencodeAssistantMessage {
  return {
    id: input.id ?? 'msg_assistant',
    sessionID: input.sessionID ?? 'ses_1',
    role: 'assistant',
    time: input.time ?? { created: 1, completed: 2 },
    parentID: input.parentID ?? 'msg_user',
    modelID: input.modelID ?? 'gpt-5',
    providerID: input.providerID ?? 'openai',
    mode: input.mode ?? 'build',
    path: input.path ?? { cwd: '/tmp/workspace', root: '/tmp/workspace' },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? {
      input: 10,
      output: 3,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: input.finish ?? 'stop',
  }
}

function textPart(input: Partial<Extract<OpencodePart, { type: 'text' }>> = {}): Extract<OpencodePart, { type: 'text' }> {
  return {
    id: input.id ?? 'part_text',
    sessionID: input.sessionID ?? 'ses_1',
    messageID: input.messageID ?? 'msg_assistant',
    type: 'text',
    text: input.text ?? 'Done.',
    time: input.time ?? { start: 1, end: 2 },
  }
}

function createFakeResource(events: AsyncEventStream<OpencodeEvent>) {
  const state: {
    sessionListData: unknown[]
    sessionMessagesData: unknown[]
    forkSessionData: unknown
    sessionStatusData: Record<string, unknown>
    sessionTodoData: unknown[]
    sessionDiffData: unknown[]
    sessionGetData: unknown
    sessionCreateData: unknown
    sessionChildrenData: unknown[]
    mcpStatusData: Record<string, unknown>
    fileStatusData: unknown[]
    appAgentsData: unknown[]
  } = {
    sessionListData: [],
    sessionMessagesData: [],
    forkSessionData: null,
    sessionStatusData: {},
    sessionTodoData: [],
    sessionDiffData: [],
    sessionGetData: null,
    sessionCreateData: { id: 'ses_recovered' },
    sessionChildrenData: [],
    mcpStatusData: {},
    fileStatusData: [],
    appAgentsData: [],
  }
  const promptAsync = vi.fn(async (_options: { body: { messageID?: string, agent?: string } }) => ({
    data: undefined,
    error: undefined,
  }))
  const message = vi.fn(async (options?: { path?: { messageID?: string } }) => ({
    data: state.sessionMessagesData.find((entry) =>
      Boolean(
        entry
        && typeof entry === 'object'
        && 'info' in entry
        && entry.info
        && typeof entry.info === 'object'
        && 'id' in entry.info
        && entry.info.id === options?.path?.messageID,
      ),
    ) ?? {
      info: assistantMessage(),
      parts: [textPart()],
    },
    error: undefined,
  }))
  const postPermission = vi.fn(async () => ({ data: true, error: undefined }))
  const session = {
    promptAsync,
    create: vi.fn(async () => ({ data: state.sessionCreateData, error: undefined })),
    prompt: vi.fn(),
    command: vi.fn(),
    message,
    list: vi.fn(async () => ({ data: state.sessionListData, error: undefined })),
    get: vi.fn(async () => ({ data: state.sessionGetData, error: undefined })),
    messages: vi.fn(async () => ({ data: state.sessionMessagesData, error: undefined })),
    fork: vi.fn(async () => ({ data: state.forkSessionData, error: undefined })),
    children: vi.fn(async () => ({ data: state.sessionChildrenData, error: undefined })),
    delete: vi.fn(),
    status: vi.fn(async () => ({ data: state.sessionStatusData, error: undefined })),
    todo: vi.fn(async () => ({ data: state.sessionTodoData, error: undefined })),
    diff: vi.fn(async () => ({ data: state.sessionDiffData, error: undefined })),
  }
  const resource = {
    client: {
      event: {
        subscribe: vi.fn(async () => ({ stream: events })),
      },
      command: {
        list: vi.fn(async () => ({ data: [], error: undefined })),
      },
      session,
      app: {
        agents: vi.fn(async () => ({ data: state.appAgentsData, error: undefined })),
      },
      mcp: {
        status: vi.fn(async () => ({ data: state.mcpStatusData, error: undefined })),
      },
      file: {
        status: vi.fn(async () => ({ data: state.fileStatusData, error: undefined })),
      },
      postSessionIdPermissionsPermissionId: postPermission,
    },
    server: {
      url: 'http://127.0.0.1:1234',
      close() {},
    },
  } as unknown as OpencodeRuntimeResource

  return {
    resource,
    promptAsync,
    message,
    postPermission,
    session,
    state,
  }
}

describe('formatOpencodeAssistantError', () => {
  it('keeps upstream unsupported model details from opencode API errors', () => {
    const error: OpencodeAssistantError = {
      name: 'APIError',
      data: {
        message: 'Not Found: 当前 API 不支持所选模型 gpt-5.5',
        statusCode: 404,
        isRetryable: false,
        responseHeaders: {},
        responseBody: '{"error":"当前 API 不支持所选模型 gpt-5.5","type":"error"}',
      },
    }

    expect(formatOpencodeAssistantError(error)).toBe('404: Not Found: 当前 API 不支持所选模型 gpt-5.5')
  })

  it('keeps upstream credential failure details from opencode API errors', () => {
    const error: OpencodeAssistantError = {
      name: 'APIError',
      data: {
        message:
          'Unauthorized: {"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid"}}',
        statusCode: 401,
        isRetryable: false,
        responseHeaders: {},
        responseBody:
          '{"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid"}}',
      },
    }

    expect(formatOpencodeAssistantError(error)).toContain('401: Unauthorized')
    expect(formatOpencodeAssistantError(error)).toContain('the API key or AK/SK in the request is missing or invalid')
  })
})

describe('OpencodeProvider provider threads', () => {
  it('lists native OpenCode sessions and hydrates message turns', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionListData.push({
      id: 'ses_child',
      projectID: 'project-1',
      directory: '/tmp/workspace',
      parentID: 'ses_1',
      title: 'Child session',
      version: '1.17.11',
      time: { created: 1, updated: 3 },
    })
    fake.state.sessionMessagesData.push(
      {
        info: {
          id: 'msg_user',
          sessionID: 'ses_child',
          role: 'user',
          time: { created: 1 },
          agent: 'build',
          model: { providerID: 'openai', modelID: 'gpt-5' },
        },
        parts: [{ id: 'part_user', sessionID: 'ses_child', messageID: 'msg_user', type: 'text', text: 'Hi' }],
      },
      {
        info: assistantMessage({ id: 'msg_assistant', sessionID: 'ses_child', parentID: 'msg_user' }),
        parts: [textPart({ id: 'part_assistant', sessionID: 'ses_child', messageID: 'msg_assistant', text: 'Hello' })],
      },
    )

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const runtimeSession = createRuntimeSession(fake.resource)
    await expect(provider.listProviderThreads({
      runtimeSession,
      profile: null,
      workspacePath: '/tmp/workspace',
    })).resolves.toMatchObject({
      runtimeKind: 'opencode',
      providerSessionId: 'ses_1',
      threads: [
        {
          id: 'ses_child',
          forkedFromId: 'ses_1',
          name: 'Child session',
          sourceKind: 'appServer',
        },
      ],
    })

    await expect(provider.listProviderThreadTurns({
      runtimeSession,
      profile: null,
      workspacePath: '/tmp/workspace',
      threadId: 'ses_child',
    })).resolves.toMatchObject({
      runtimeKind: 'opencode',
      threadId: 'ses_child',
      turns: [
        { id: 'msg_user', status: 'completed' },
        { id: 'msg_assistant', status: 'completed' },
      ],
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
      ],
    })
  })

  it('forks the native OpenCode session for side conversations', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.forkSessionData = {
      id: 'ses_fork',
      projectID: 'project-1',
      directory: '/tmp/workspace',
      parentID: 'ses_1',
      title: 'Forked session',
      version: '1.17.11',
      time: { created: 1, updated: 1 },
    }

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.forkRuntimeSession({
      sourceRuntimeSession: createRuntimeSession(fake.resource),
      childChatSessionId: 'side-1',
      profile: null,
      workspacePath: '/tmp/workspace',
      modelId: 'openai/gpt-5',
    })).resolves.toMatchObject({
      chatSessionId: 'side-1',
      providerSessionId: 'ses_fork',
      runtimeKind: 'opencode',
    })
    expect(fake.session.fork).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_1' },
      query: { directory: '/tmp/workspace' },
    }))
  })

  it('reads native OpenCode thread metadata with share, summary, revert, and child count', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionGetData = {
      id: 'ses_shared',
      projectID: 'project-1',
      directory: '/tmp/workspace',
      title: 'Shared session',
      version: '1.17.11',
      summary: { additions: 3, deletions: 1, files: 2 },
      share: { url: 'https://opencode.ai/s/ses_shared' },
      revert: { messageID: 'msg_old' },
      time: { created: 1, updated: 5 },
    }
    fake.state.sessionChildrenData.push(
      {
        id: 'ses_child_a',
        projectID: 'project-1',
        directory: '/tmp/workspace',
        parentID: 'ses_shared',
        title: 'Child A',
        version: '1.17.11',
        time: { created: 2, updated: 3 },
      },
      {
        id: 'ses_child_b',
        projectID: 'project-1',
        directory: '/tmp/workspace',
        parentID: 'ses_shared',
        title: 'Child B',
        version: '1.17.11',
        time: { created: 3, updated: 4 },
      },
    )

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.readProviderThread({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      threadId: 'ses_shared',
    })).resolves.toMatchObject({
      thread: {
        id: 'ses_shared',
        source: {
          shareUrl: 'https://opencode.ai/s/ses_shared',
          summary: { additions: 3, deletions: 1, files: 2 },
          revert: { messageID: 'msg_old' },
          childCount: 2,
        },
        threadSource: {
          shareUrl: 'https://opencode.ai/s/ses_shared',
          childCount: 2,
        },
      },
    })
    expect(fake.session.children).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_shared' },
      query: { directory: '/tmp/workspace' },
    }))
  })
})

describe('OpencodeProvider UI slot states', () => {
  it('projects status, todo, and diff from native OpenCode session APIs', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionStatusData.ses_1 = { type: 'busy' }
    fake.state.sessionTodoData.push(
      { id: 'todo-1', content: 'Inspect files', status: 'in_progress', priority: 'high' },
      { id: 'todo-2', content: 'Report result', status: 'pending', priority: 'medium' },
    )
    fake.state.sessionDiffData.push({
      file: 'src/app.ts',
      before: '',
      after: '',
      additions: 12,
      deletions: 3,
    })
    fake.state.mcpStatusData.github = { status: 'connected' }
    fake.state.mcpStatusData.linear = { status: 'needs_auth' }
    fake.state.fileStatusData.push(
      { path: 'src/app.ts', added: 12, removed: 3, status: 'modified' },
      { path: 'src/new.ts', added: 4, removed: 0, status: 'added' },
    )
    fake.state.appAgentsData.push({
      name: 'plan',
      description: 'Plan work before editing',
      mode: 'primary',
      builtIn: true,
      permission: { edit: 'ask', bash: {}, webfetch: 'ask' },
      model: { providerID: 'openai', modelID: 'gpt-5' },
      tools: {},
      options: {},
    })

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.getUiSlotStates({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      modelId: 'openai/gpt-5',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'status',
        slotId: 'opencode:status',
        status: 'active',
      }),
      expect.objectContaining({
        kind: 'progress',
        slotId: 'opencode:progress',
        inProgressCount: 1,
        pendingCount: 1,
      }),
      expect.objectContaining({
        kind: 'diff',
        slotId: 'opencode:diff',
        fileCount: 1,
        addedLines: 12,
        removedLines: 3,
      }),
      expect.objectContaining({
        kind: 'mcp',
        slotId: 'opencode:mcp',
        serverCount: 2,
        readyCount: 1,
        needsLoginCount: 1,
      }),
      expect.objectContaining({
        kind: 'filesystem',
        slotId: 'opencode:filesystem',
        changedPathCount: 2,
        recentPaths: ['src/app.ts', 'src/new.ts'],
      }),
      expect.objectContaining({
        kind: 'crew',
        slotId: 'opencode:crew',
        collaborationModeCount: 1,
        agents: [
          expect.objectContaining({
            name: 'plan',
            agentRole: 'primary',
            modelProvider: 'openai',
          }),
        ],
      }),
    ]))
  })
})

describe('OpencodeProvider streamTurn', () => {
  it('uses promptAsync with the build agent and closes from terminal OpenCode events', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const stream = provider.streamTurn({
      runId: 'run-1',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Implement this' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    const promptCall = fake.promptAsync.mock.calls[0]
    expect(promptCall).toBeDefined()
    const promptBody = promptCall![0].body
    expect(promptBody).not.toHaveProperty('messageID')
    expect(promptBody.agent).toBe('build')
    const assistant = assistantMessage({
      id: 'msg_assistant',
      parentID: 'msg_user',
      time: { created: 1 },
    })
    events.push({ type: 'message.updated', properties: { info: assistant } })
    events.push({ type: 'message.part.updated', properties: { part: textPart() } })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...assistant,
          time: { created: 1, completed: 2 },
          finish: 'stop',
        },
      },
    })

    await expect(firstChunk).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'Done.' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('passes the plan agent for plan-mode turns', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const stream = provider.streamTurn({
      runId: 'run-plan',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Plan this' }],
      },
      workspacePath: '/tmp/workspace',
      providerOptions: {
        runtimeSettings: {
          accessMode: 'full-access',
          interactionMode: 'plan',
        },
      },
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    const promptCall = fake.promptAsync.mock.calls[0]
    expect(promptCall).toBeDefined()
    const promptBody = promptCall![0].body
    expect(promptBody).not.toHaveProperty('messageID')
    expect(promptBody.agent).toBe('plan')
    const assistant = assistantMessage({
      id: 'msg_assistant',
      parentID: 'msg_user',
      mode: 'plan',
      time: { created: 1 },
    })
    events.push({ type: 'message.updated', properties: { info: assistant } })
    events.push({ type: 'message.part.updated', properties: { part: textPart() } })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...assistant,
          time: { created: 1, completed: 2 },
          finish: 'stop',
        },
      },
    })

    await expect(firstChunk).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'Done.' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('recovers terminal async prompts from history when the OpenCode event stream ends', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionMessagesData.push({
      info: assistantMessage({
        id: 'msg_previous_assistant',
        parentID: 'msg_previous_user',
        time: { created: 1, completed: 2 },
      }),
      parts: [textPart({ id: 'part_previous', messageID: 'msg_previous_assistant', text: 'Previous.' })],
    })
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const stream = provider.streamTurn({
      runId: 'run-stream-ended',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Implement this' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    const promptCall = fake.promptAsync.mock.calls[0]
    expect(promptCall).toBeDefined()
    const promptBody = promptCall![0].body
    expect(promptBody).not.toHaveProperty('messageID')
    fake.state.sessionMessagesData.push({
      info: assistantMessage({
        id: 'msg_assistant',
        parentID: 'msg_user',
        time: { created: 3, completed: 4 },
      }),
      parts: [textPart()],
    })
    events.close()

    await expect(firstChunk).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'Done.' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(fake.session.messages).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_1' },
      query: { directory: '/tmp/workspace', limit: 50 },
    }))
  })

  it('recovers terminal async prompts from history when OpenCode reports the session idle', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const stream = provider.streamTurn({
      runId: 'run-idle-recovery',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Implement this' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    const promptBody = fake.promptAsync.mock.calls[0]![0].body
    expect(promptBody).not.toHaveProperty('messageID')
    fake.state.sessionMessagesData.push({
      info: assistantMessage({
        id: 'msg_assistant',
        parentID: 'msg_user',
        time: { created: 1, completed: 2 },
      }),
      parts: [textPart()],
    })
    events.push({
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    })
    events.push({
      type: 'session.idle',
      properties: { sessionID: 'ses_1' },
    })

    await expect(firstChunk).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.status' } },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.idle' } },
    })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'Done.' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(fake.session.messages).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_1' },
      query: { directory: '/tmp/workspace', limit: 50 },
    }))
  })

  it('reuses the native session across consecutive promptAsync turns without custom message IDs', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const runtimeSession = createRuntimeSession(fake.resource)

    const firstStream = provider.streamTurn({
      runId: 'run-first',
      runtimeSession,
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'First turn' }],
      },
      workspacePath: '/tmp/workspace',
    })
    const firstChunk = firstStream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    expect(fake.promptAsync.mock.calls[0]![0].body).not.toHaveProperty('messageID')
    const firstAssistant = assistantMessage({
      id: 'msg_assistant_first',
      parentID: 'msg_user_first',
      time: { created: 1 },
    })
    fake.state.sessionMessagesData.push({
      info: {
        ...firstAssistant,
        time: { created: 1, completed: 2 },
        finish: 'stop',
      },
      parts: [textPart({
        id: 'part_text_first',
        messageID: 'msg_assistant_first',
        text: 'First.',
      })],
    })
    events.push({ type: 'message.updated', properties: { info: firstAssistant } })
    events.push({
      type: 'message.part.updated',
      properties: {
        part: textPart({
          id: 'part_text_first',
          messageID: 'msg_assistant_first',
          text: 'First.',
        }),
      },
    })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...firstAssistant,
          time: { created: 1, completed: 2 },
          finish: 'stop',
        },
      },
    })

    await expect(firstChunk).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(firstStream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'First.' } })
    await expect(firstStream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(firstStream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(firstStream.next()).resolves.toEqual({ done: true, value: undefined })

    const secondStream = provider.streamTurn({
      runId: 'run-second',
      runtimeSession,
      profile: null,
      message: {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'Second turn' }],
      },
      workspacePath: '/tmp/workspace',
    })
    const secondChunk = secondStream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(2))
    expect(fake.promptAsync.mock.calls[1]![0]).toMatchObject({
      path: { id: 'ses_1' },
      body: { agent: 'build' },
    })
    expect(fake.promptAsync.mock.calls[1]![0].body).not.toHaveProperty('messageID')
    const secondAssistant = assistantMessage({
      id: 'msg_assistant_second',
      parentID: 'msg_user_second',
      time: { created: 3 },
    })
    fake.state.sessionMessagesData.push({
      info: {
        ...secondAssistant,
        time: { created: 3, completed: 4 },
        finish: 'stop',
      },
      parts: [textPart({
        id: 'part_text_second',
        messageID: 'msg_assistant_second',
        text: 'Second.',
      })],
    })
    events.push({ type: 'message.updated', properties: { info: secondAssistant } })
    events.push({
      type: 'message.part.updated',
      properties: {
        part: textPart({
          id: 'part_text_second',
          messageID: 'msg_assistant_second',
          text: 'Second.',
        }),
      },
    })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...secondAssistant,
          time: { created: 3, completed: 4 },
          finish: 'stop',
        },
      },
    })

    await expect(secondChunk).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(secondStream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'Second.' } })
    await expect(secondStream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(secondStream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(secondStream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(fake.session.create).not.toHaveBeenCalled()
  })

  it('retries async prompts in a fresh native session when OpenCode goes idle without a terminal assistant', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const runtimeSession = createRuntimeSession(fake.resource)
    const stream = provider.streamTurn({
      runId: 'run-idle-empty',
      runtimeSession,
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Say hi' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    events.push({
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    })
    events.push({
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'idle' } },
    })

    await expect(firstChunk).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.status' } },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.status' } },
    })
    await vi.waitFor(() => expect(fake.session.create).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(2))
    expect(runtimeSession.providerSessionId).toBe('ses_recovered')
    expect(fake.promptAsync.mock.calls[1]![0]).toMatchObject({
      path: { id: 'ses_recovered' },
      body: {
        agent: 'build',
      },
    })
    expect(fake.promptAsync.mock.calls[1]![0].body).not.toHaveProperty('messageID')
    const recoveredAssistant = assistantMessage({
      id: 'msg_assistant_recovered',
      sessionID: 'ses_recovered',
      parentID: 'msg_user_recovered',
      time: { created: 3 },
    })
    fake.state.sessionMessagesData.push({
      info: {
        ...recoveredAssistant,
        time: { created: 3, completed: 4 },
        finish: 'stop',
      },
      parts: [textPart({
        id: 'part_text_recovered',
        sessionID: 'ses_recovered',
        messageID: 'msg_assistant_recovered',
      })],
    })
    events.push({ type: 'message.updated', properties: { info: recoveredAssistant } })
    events.push({
      type: 'message.part.updated',
      properties: {
        part: textPart({
          id: 'part_text_recovered',
          sessionID: 'ses_recovered',
          messageID: 'msg_assistant_recovered',
        }),
      },
    })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...recoveredAssistant,
          time: { created: 3, completed: 4 },
          finish: 'stop',
        },
      },
    })

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.recovered' } },
    })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'Done.' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('bridges OpenCode permission events through runtime tool approvals', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const approvalResolver: {
      resolve?: (resolution: RuntimeToolApprovalResolution) => void
    } = {}
    const requestToolApproval = vi.fn((_request: RuntimeToolApprovalRequest) =>
      new Promise<RuntimeToolApprovalResolution>(resolve => {
        approvalResolver.resolve = resolve
      }))
    const provider = new OpencodeProvider({
      readSecret: () => 'secret',
      requestToolApproval,
    })
    const stream = provider.streamTurn({
      runId: 'run-approval',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Run a command' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    const permission: OpencodePermission = {
      id: 'perm-1',
      type: 'bash',
      pattern: 'rm -rf build',
      sessionID: 'ses_1',
      messageID: 'msg_assistant',
      callID: 'call-1',
      title: 'Run command',
      metadata: { reason: 'destructive command' },
      time: { created: 10 },
    }
    events.push({ type: 'permission.updated', properties: permission })

    await expect(firstChunk).resolves.toMatchObject({
      done: false,
      value: { type: 'tool-input-start', toolCallId: 'server-request-perm-1' },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'tool-input-available',
        toolCallId: 'server-request-perm-1',
        input: expect.objectContaining({ apiName: 'approval.permissions' }),
      },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'tool-approval-request',
        approvalId: 'server-request-perm-1',
      },
    })
    expect(requestToolApproval).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: 'perm-1',
      providerMethod: 'permission.updated',
      toolCallId: 'server-request-perm-1',
    }))

    approvalResolver.resolve?.({ requestId: 'perm-1', approved: true })
    await vi.waitFor(() => expect(fake.postPermission).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_1', permissionID: 'perm-1' },
      body: { response: 'once' },
    })))
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'tool-output-available',
        toolCallId: 'server-request-perm-1',
        output: expect.objectContaining({ apiName: 'approval.permissions' }),
      },
    })
    await stream.return(undefined)
  })
})
