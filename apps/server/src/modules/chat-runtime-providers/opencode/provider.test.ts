import type {
  AssistantMessage as OpencodeAssistantMessage,
  Event as OpencodeLegacyEvent,
  Part as OpencodePart,
} from '@opencode-ai/sdk'
import type { Event as OpencodeRootEvent } from '@opencode-ai/sdk/v2'
import { describe, expect, it, vi } from 'vitest'

import type {
  RuntimeSession,
  RuntimeToolApprovalRequest,
  RuntimeToolApprovalResolution,
  RuntimeUserInputRequest,
  RuntimeUserInputResolution,
} from '../../chat-runtime/runtime-provider-types'
import { formatOpencodeAssistantError, OpencodeProvider } from './provider'
import type { OpencodeRuntimeResource } from './runtime-context'

type OpencodeAssistantError = NonNullable<OpencodeAssistantMessage['error']>
type OpencodeEvent = OpencodeLegacyEvent | OpencodeRootEvent

class AsyncEventStream<T> implements AsyncIterable<T> {
  private readonly backlog: T[] = []
  private readonly subscribers = new Set<{
    values: T[]
    waiters: Array<(value: IteratorResult<T>) => void>
  }>()

  private closed = false

  push(value: T): void {
    if (this.subscribers.size === 0) {
      this.backlog.push(value)
      return
    }
    for (const subscriber of this.subscribers) {
      const waiter = subscriber.waiters.shift()
      if (waiter) {
        waiter({ value, done: false })
        continue
      }
      subscriber.values.push(value)
    }
  }

  close(): void {
    this.closed = true
    for (const subscriber of this.subscribers) {
      for (const waiter of subscriber.waiters.splice(0)) {
        waiter({ value: undefined, done: true })
      }
    }
    this.subscribers.clear()
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const subscriber = {
      values: this.backlog.splice(0),
      waiters: [] as Array<(value: IteratorResult<T>) => void>,
    }
    this.subscribers.add(subscriber)
    return {
      next: async () => {
        if (subscriber.values.length > 0) {
          return { value: subscriber.values.shift()!, done: false }
        }
        if (this.closed) {
          return { value: undefined, done: true }
        }
        return await new Promise<IteratorResult<T>>(resolve => subscriber.waiters.push(resolve))
      },
      return: async () => {
        this.subscribers.delete(subscriber)
        for (const waiter of subscriber.waiters.splice(0)) {
          waiter({ value: undefined, done: true })
        }
        return { value: undefined, done: true }
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

function assistantMessage(input: Partial<OpencodeAssistantMessage> = {}): OpencodeAssistantMessage & { agent: string } {
  return {
    id: input.id ?? 'msg_assistant',
    sessionID: input.sessionID ?? 'ses_1',
    role: 'assistant',
    time: input.time ?? { created: 1, completed: 2 },
    parentID: input.parentID ?? 'msg_user',
    modelID: input.modelID ?? 'gpt-5',
    providerID: input.providerID ?? 'openai',
    mode: input.mode ?? 'build',
    agent: 'build',
    path: input.path ?? { cwd: '/tmp/workspace', root: '/tmp/workspace' },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? {
      input: 10,
      output: 3,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...('finish' in input ? {} : { finish: 'stop' as const }),
    ...input,
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
    sessionQuestionRequestsData: unknown[]
    sessionContextMessagesData: unknown[]
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
    sessionQuestionRequestsData: [],
    sessionContextMessagesData: [],
    mcpStatusData: {},
    fileStatusData: [],
    appAgentsData: [],
  }
  const promptAsync = vi.fn(async (_options: { body: { messageID?: string, agent?: string } }) => ({
    data: undefined,
    error: undefined,
  }))
  const message = vi.fn(async (options?: { path?: { messageID?: string } }) => ({
    data: state.sessionMessagesData.find(entry =>
      Boolean(
        entry
        && typeof entry === 'object'
        && 'info' in entry
        && entry.info
        && typeof entry.info === 'object'
        && 'id' in entry.info
        && entry.info.id === options?.path?.messageID,
      )) ?? {
      info: assistantMessage(),
      parts: [textPart()],
    },
    error: undefined,
  }))
  const postPermission = vi.fn(async () => ({ data: true, error: undefined }))
  const permissionReply = vi.fn(async () => ({ data: undefined, error: undefined }))
  const questionList = vi.fn(async () => ({ data: { data: state.sessionQuestionRequestsData }, error: undefined }))
  const questionReply = vi.fn(async () => ({ data: undefined, error: undefined }))
  const questionReject = vi.fn(async () => ({ data: undefined, error: undefined }))
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
    v2Client: {
      event: {
        subscribe: vi.fn(async () => ({ stream: events })),
      },
      v2: {
        session: {
          context: vi.fn(async () => ({ data: { data: state.sessionContextMessagesData }, error: undefined })),
          permission: {
            reply: permissionReply,
          },
          question: {
            list: questionList,
            reply: questionReply,
            reject: questionReject,
          },
        },
      },
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
    permissionReply,
    questionList,
    questionReply,
    questionReject,
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

describe('opencodeProvider provider threads', () => {
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

  it('resolves subagent provider threads from task toolCallId aliases', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.session.get = vi.fn(async (options?: { path?: { id?: string } }) => {
      if (options?.path?.id === 'ses_child') {
        return {
          data: {
            id: 'ses_child',
            projectID: 'project-1',
            directory: '/tmp/workspace',
            parentID: 'ses_1',
            title: 'Explore auth module',
            version: '1.17.11',
            time: { created: 2, updated: 3 },
          },
          error: undefined,
        }
      }
      return { data: fake.state.sessionGetData, error: undefined }
    })
    fake.session.messages = vi.fn(async (options?: { path?: { id?: string } }) => ({
      data: fake.state.sessionMessagesData.filter(entry =>
        Boolean(
          entry
          && typeof entry === 'object'
          && 'info' in entry
          && entry.info
          && typeof entry.info === 'object'
          && 'sessionID' in entry.info
          && entry.info.sessionID === options?.path?.id,
        )),
      error: undefined,
    }))
    fake.state.sessionMessagesData = [
      {
        info: {
          id: 'msg_assistant',
          sessionID: 'ses_1',
          role: 'assistant',
          time: { created: 1 },
          parentID: 'msg_user',
          modelID: 'gpt-5',
          providerID: 'openai',
          mode: 'build',
          path: { cwd: '/tmp/workspace', root: '/tmp/workspace' },
          cost: 0,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [{
          id: 'part_task',
          sessionID: 'ses_1',
          messageID: 'msg_assistant',
          type: 'tool',
          callID: 'call_task_1',
          tool: 'task',
          state: {
            status: 'running',
            input: { description: 'Explore auth module', subagent_type: 'explore' },
            title: 'Explore auth module',
            metadata: { sessionId: 'ses_child', parentSessionId: 'ses_1' },
            time: { start: 1 },
          },
        }],
      },
      {
        info: assistantMessage({ id: 'msg_child_assistant', sessionID: 'ses_child' }),
        parts: [textPart({ id: 'part_child', sessionID: 'ses_child', messageID: 'msg_child_assistant', text: 'Found 3 files' })],
      },
    ]

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const runtimeSession = createRuntimeSession(fake.resource)

    await expect(provider.readProviderThread({
      runtimeSession,
      profile: null,
      workspacePath: '/tmp/workspace',
      threadId: 'call_task_1',
    })).resolves.toMatchObject({
      thread: {
        id: 'call_task_1',
        forkedFromId: 'call_task_1',
        agentNickname: 'explore',
        name: 'Explore auth module',
        source: {
          type: 'opencode-subagent',
          childSessionId: 'ses_child',
          toolCallId: 'call_task_1',
        },
      },
    })

    await expect(provider.listProviderThreadTurns({
      runtimeSession,
      profile: null,
      workspacePath: '/tmp/workspace',
      threadId: 'call_task_1',
    })).resolves.toMatchObject({
      threadId: 'call_task_1',
      turns: [
        { id: 'msg_child_assistant', status: 'completed' },
      ],
      messages: [
        { role: 'assistant', parts: [{ type: 'text', text: 'Found 3 files' }] },
      ],
    })
    expect(fake.session.get).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_child' },
    }))
    expect(fake.session.messages).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'ses_child' },
    }))
  })
})

describe('opencodeProvider UI slot states', () => {
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
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const states = await provider.getUiSlotStates({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      modelId: 'openai/gpt-5',
    })
    expect(states).toEqual(expect.arrayContaining([
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
    ]))
    expect(states.find(state => state.kind === 'crew')).toBeUndefined()
  })

  it('projects crew state only from current session task subagents', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
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
    fake.state.sessionMessagesData = [{
      info: assistantMessage({ id: 'msg_parent', sessionID: 'ses_1' }),
      parts: [{
        id: 'part_task',
        sessionID: 'ses_1',
        messageID: 'msg_parent',
        type: 'tool',
        callID: 'call_task_1',
        tool: 'task',
        state: {
          status: 'completed',
          input: { description: 'Explore opencode bridge', subagent_type: 'explore' },
          output: 'task_id: ses_child',
          title: 'Explore opencode bridge',
          metadata: { sessionId: 'ses_child', parentSessionId: 'ses_1' },
          time: { start: 10, end: 20 },
        },
      }],
    }]

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.getUiSlotStates({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      modelId: 'openai/gpt-5',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'crew',
        slotId: 'opencode:crew',
        activeCount: 0,
        completedCount: 1,
        failedCount: 0,
        collaborationModeCount: 0,
        collaborationModes: [],
        agents: [
          expect.objectContaining({
            threadId: 'call_task_1',
            name: 'explore',
            status: 'completed',
          }),
        ],
        calls: [
          expect.objectContaining({
            id: 'call_task_1',
            status: 'completed',
            receiverThreadIds: ['call_task_1'],
            prompt: 'Explore opencode bridge',
          }),
        ],
      }),
    ]))
  })

  it('projects pending v2 session questions as recovered user-input slot state', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionQuestionRequestsData.push({
      id: 'question-request-recovered',
      sessionID: 'ses_1',
      questions: [{
        question: '怎么继续？',
        header: 'Next step',
        multiple: false,
        custom: true,
        options: [
          { label: '跑测试', description: '先验证当前变更' },
        ],
      }],
      tool: {
        messageID: 'msg_question',
        callID: 'call_question_recovered',
      },
    })

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.getUiSlotStates({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      modelId: 'openai/gpt-5',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'userInput',
        slotId: 'opencode:user-input',
        requestId: 'question-request-recovered',
        toolCallId: 'call_question_recovered',
        questionCount: 1,
        questions: [
          expect.objectContaining({
            id: 'question-1',
            header: 'Next step',
            question: '怎么继续？',
            isOther: true,
            multiSelect: false,
          }),
        ],
      }),
    ]))
  })
})

describe('opencodeProvider native user-input submission', () => {
  it('replies to pending v2 session questions by request id', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionQuestionRequestsData.push({
      id: 'question-request-native',
      sessionID: 'ses_1',
      questions: [
        {
          question: '第一步？',
          header: 'First',
          multiple: false,
          custom: false,
          options: [{ label: 'A', description: 'Option A' }],
        },
        {
          question: '第二步？',
          header: 'Second',
          multiple: true,
          custom: false,
          options: [{ label: 'B', description: 'Option B' }],
        },
      ],
      tool: {
        messageID: 'msg_question',
        callID: 'call_question_native',
      },
    })

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.submitUserInput?.({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      requestId: 'question-request-native',
      answers: {
        'question-1': ['A'],
        'question-2': ['B', 'Other'],
      },
    })).resolves.toEqual({
      requestId: 'question-request-native',
      answers: {
        'question-1': ['A'],
        'question-2': ['B', 'Other'],
      },
    })
    expect(fake.questionReply).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      requestID: 'question-request-native',
      questionV2Reply: {
        answers: [['A'], ['B', 'Other']],
      },
    })
  })
})

describe('opencodeProvider context usage', () => {
  it('projects v2 session context messages into context usage sections', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    fake.state.sessionContextMessagesData.push(
      {
        id: 'ctx_user_1',
        type: 'user',
        time: { created: 1 },
        text: '请检查 package.json',
        files: [{ type: 'file', url: 'file:///tmp/workspace/package.json', filename: 'package.json' }],
        agents: [{ name: 'build' }],
      },
      {
        id: 'ctx_shell_1',
        type: 'shell',
        time: { created: 2, completed: 3 },
        callID: 'shell_1',
        command: 'pnpm test',
        output: 'ok',
      },
      {
        id: 'ctx_assistant_1',
        type: 'assistant',
        time: { created: 4, completed: 5 },
        agent: 'build',
        model: { providerID: 'openai', id: 'gpt-5' },
        content: [{ type: 'text', id: 'text_1', text: 'Done' }],
        tokens: {
          input: 10,
          output: 4,
          reasoning: 2,
          cache: { read: 3, write: 1 },
        },
      },
    )

    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    await expect(provider.getContextUsage({
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      workspacePath: '/tmp/workspace',
      modelId: 'openai/gpt-5',
    })).resolves.toMatchObject({
      runtimeKind: 'opencode',
      providerSessionId: 'ses_1',
      source: 'opencode-v2-session-context',
      model: 'openai/gpt-5',
      totalTokens: 20,
      sections: expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant',
          tokenCount: 20,
        }),
        expect.objectContaining({
          kind: 'user',
          tokenCount: 0,
          items: [
            expect.objectContaining({
              metadata: expect.objectContaining({ fileCount: 1, agentCount: 1 }),
            }),
          ],
        }),
        expect.objectContaining({
          kind: 'shell',
          items: [
            expect.objectContaining({
              label: 'pnpm test',
              metadata: expect.objectContaining({ callId: 'shell_1' }),
            }),
          ],
        }),
      ]),
      messageBreakdown: {
        messageCounts: { user: 1, shell: 1, assistant: 1 },
        tokenBreakdown: {
          inputTokens: 10,
          cachedInputTokens: 3,
          cacheWriteTokens: 1,
          outputTokens: 4,
          reasoningOutputTokens: 2,
        },
      },
    })
  })
})

describe('opencodeProvider streamTurn', () => {
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

  it('fails fast when the event stream subscription fails before async prompt recovery is ready', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const subscribeError = new Error('SSE unavailable')
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const recordObservability = vi.fn()
    vi.mocked(fake.resource.v2Client.event.subscribe).mockRejectedValueOnce(subscribeError)
    const provider = new OpencodeProvider({
      readSecret: () => 'secret',
      logger,
      recordObservability,
    })
    const stream = provider.streamTurn({
      runId: 'run-subscribe-failed',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Implement this' }],
      },
      workspacePath: '/tmp/workspace',
    })

    await expect(stream.next()).rejects.toThrow('event stream subscription failed before async prompt recovery was initialized')
    expect(logger.warn).toHaveBeenCalledWith('opencode event stream subscription failed', expect.objectContaining({
      error: subscribeError,
      sessionId: 'ses_1',
      workspacePath: '/tmp/workspace',
    }))
    expect(recordObservability).toHaveBeenCalledWith(expect.objectContaining({
      code: 'OPENCODE_EVENT_STREAM_SUBSCRIBE_FAILED',
      severity: 'warn',
      category: 'provider',
      attrs: expect.objectContaining({
        runtimeKind: 'opencode',
        providerSessionId: 'ses_1',
        workspacePath: '/tmp/workspace',
      }),
    }))
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

  it('retries async prompts in a fresh native session when the OpenCode event stream ends without a terminal assistant', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    let promptAsyncCalls = 0
    fake.promptAsync.mockImplementation(async () => {
      promptAsyncCalls += 1
      if (promptAsyncCalls === 2) {
        fake.state.sessionMessagesData.push({
          info: assistantMessage({
            id: 'msg_assistant_recovered',
            sessionID: 'ses_recovered',
            parentID: 'msg_user_recovered',
            time: { created: 3, completed: 4 },
            finish: 'stop',
          }),
          parts: [textPart({
            id: 'part_text_recovered',
            sessionID: 'ses_recovered',
            messageID: 'msg_assistant_recovered',
          })],
        })
      }
      return { data: undefined, error: undefined }
    })
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const runtimeSession = createRuntimeSession(fake.resource)
    const stream = provider.streamTurn({
      runId: 'run-stream-empty',
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

    events.close()

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

  it('keeps streaming across tool-calls finish and idle between agent-loop steps', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const provider = new OpencodeProvider({ readSecret: () => 'secret' })
    const stream = provider.streamTurn({
      runId: 'run-tool-loop',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Run checks' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    const assistant = assistantMessage({
      id: 'msg_assistant',
      parentID: 'msg_user',
      time: { created: 1 },
      finish: undefined,
    })
    const toolPart = {
      id: 'part_tool',
      sessionID: 'ses_1',
      messageID: 'msg_assistant',
      type: 'tool',
      callID: 'call_1',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { command: 'pnpm typecheck' },
        output: 'ok',
        title: 'Command completed',
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } satisfies OpencodePart

    events.push({ type: 'message.updated', properties: { info: assistant } })
    events.push({ type: 'message.part.updated', properties: { part: toolPart } })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...assistant,
          time: { created: 1, completed: 2 },
          finish: 'tool-calls',
        },
      },
    })
    events.push({
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    })
    events.push({
      type: 'session.idle',
      properties: { sessionID: 'ses_1' },
    })

    await expect(firstChunk).resolves.toMatchObject({ done: false, value: { type: 'tool-input-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'tool-input-available' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'tool-output-available' } })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.status' } },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.idle' } },
    })

    events.push({
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    })
    events.push({
      type: 'message.part.updated',
      properties: {
        part: textPart({
          id: 'part_text_final',
          messageID: 'msg_assistant',
          text: 'All checks passed.',
        }),
      },
    })
    fake.state.sessionMessagesData.push({
      info: {
        ...assistant,
        time: { created: 1, completed: 4 },
        finish: 'stop',
      },
      parts: [
        toolPart,
        textPart({
          id: 'part_text_final',
          messageID: 'msg_assistant',
          text: 'All checks passed.',
        }),
      ],
    })
    events.push({
      type: 'message.updated',
      properties: {
        info: {
          ...assistant,
          time: { created: 1, completed: 4 },
          finish: 'stop',
        },
      },
    })

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'data-runtime-event', data: { kind: 'opencode.session.status' } },
    })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-start' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-delta', delta: 'All checks passed.' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'text-end' } })
    await expect(stream.next()).resolves.toMatchObject({ done: false, value: { type: 'finish' } })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(fake.session.create).not.toHaveBeenCalled()
  })

  it('bridges OpenCode permission events through runtime tool approvals', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const approvalResolver: {
      resolve?: (resolution: RuntimeToolApprovalResolution) => void
    } = {}
    const requestToolApproval = vi.fn((_request: RuntimeToolApprovalRequest) =>
      new Promise<RuntimeToolApprovalResolution>((resolve) => {
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
    events.push({
      id: 'evt_permission_asked',
      type: 'permission.asked',
      properties: {
        id: 'perm-1',
        sessionID: 'ses_1',
        permission: 'bash',
        patterns: ['rm -rf build'],
        metadata: { reason: 'destructive command' },
        always: [],
        tool: {
          messageID: 'msg_assistant',
          callID: 'call-1',
        },
      },
    })

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
      providerMethod: 'permission.asked',
      toolCallId: 'server-request-perm-1',
    }))

    approvalResolver.resolve?.({ requestId: 'perm-1', approved: true })
    await vi.waitFor(() => expect(fake.permissionReply).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      requestID: 'perm-1',
      reply: 'once',
    }))
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

  it('bridges OpenCode question tools through runtime user input and replies to the session question request', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const userInputResolver: {
      resolve?: (resolution: RuntimeUserInputResolution) => void
    } = {}
    const requestUserInput = vi.fn((_request: RuntimeUserInputRequest) =>
      new Promise<RuntimeUserInputResolution>((resolve) => {
        userInputResolver.resolve = resolve
      }))
    const provider = new OpencodeProvider({
      readSecret: () => 'secret',
      requestUserInput,
    })
    const stream = provider.streamTurn({
      runId: 'run-question',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Ask before continuing' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    events.push({
      type: 'message.updated',
      properties: { info: assistantMessage({ time: { created: 1 }, finish: undefined }) },
    })
    events.push({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_question',
          sessionID: 'ses_1',
          messageID: 'msg_assistant',
          type: 'tool',
          callID: 'call_question_1',
          tool: 'question',
          state: {
            status: 'running',
            input: {
              questions: [{
                question: '你想怎么尝试？',
                header: '尝试 subAgent',
                options: [
                  { label: '跑测试验证', description: '运行 provider.test.ts 和 subagent-bridge.test.ts 确认所有测试通过' },
                  { label: '提交后试', description: '先提交改动，再在运行的 app 里试' },
                ],
              }],
            },
            time: { start: 10 },
          },
        } satisfies OpencodePart,
      },
    })

    await expect(firstChunk).resolves.toMatchObject({
      done: false,
      value: { type: 'tool-input-start', toolCallId: 'call_question_1', toolName: 'question' },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'tool-input-available',
        toolCallId: 'call_question_1',
        input: expect.objectContaining({
          args: expect.objectContaining({
            questions: expect.any(Array),
          }),
        }),
      },
    })
    expect(requestUserInput).not.toHaveBeenCalled()

    events.push({
      id: 'evt_question_asked',
      type: 'question.v2.asked',
      properties: {
        id: 'question-request-1',
        sessionID: 'ses_1',
        questions: [{
          question: '你想怎么尝试？',
          header: '尝试 subAgent',
          options: [
            { label: '跑测试验证', description: '运行 provider.test.ts 和 subagent-bridge.test.ts 确认所有测试通过' },
            { label: '提交后试', description: '先提交改动，再在运行的 app 里试' },
          ],
        }],
        tool: {
          messageID: 'msg_assistant',
          callID: 'call_question_1',
        },
      },
    })

    await vi.waitFor(() => expect(requestUserInput).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: 'question-request-1',
      providerMethod: 'question',
      toolCallId: 'call_question_1',
      questions: [{
        id: 'question-1',
        header: '尝试 subAgent',
        question: '你想怎么尝试？',
        isOther: false,
        isSecret: false,
        multiSelect: false,
        options: [
          { label: '跑测试验证', description: '运行 provider.test.ts 和 subagent-bridge.test.ts 确认所有测试通过' },
          { label: '提交后试', description: '先提交改动，再在运行的 app 里试' },
        ],
      }],
    })))

    userInputResolver.resolve?.({
      requestId: 'question-request-1',
      answers: { 'question-1': ['跑测试验证'] },
    })
    await vi.waitFor(() => expect(fake.questionReply).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      requestID: 'question-request-1',
      questionV2Reply: {
        answers: [['跑测试验证']],
      },
    }))
    expect(fake.questionReject).not.toHaveBeenCalled()
    await stream.return(undefined)
  })

  it('bridges OpenCode question requests from v2 events when the root tool event arrives before list visibility', async () => {
    const events = new AsyncEventStream<OpencodeEvent>()
    const fake = createFakeResource(events)
    const userInputResolver: {
      resolve?: (resolution: RuntimeUserInputResolution) => void
    } = {}
    const requestUserInput = vi.fn((_request: RuntimeUserInputRequest) =>
      new Promise<RuntimeUserInputResolution>((resolve) => {
        userInputResolver.resolve = resolve
      }))
    const provider = new OpencodeProvider({
      readSecret: () => 'secret',
      requestUserInput,
    })
    const stream = provider.streamTurn({
      runId: 'run-question-race',
      runtimeSession: createRuntimeSession(fake.resource),
      profile: null,
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Ask before continuing' }],
      },
      workspacePath: '/tmp/workspace',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => expect(fake.promptAsync).toHaveBeenCalledTimes(1))
    events.push({
      type: 'message.updated',
      properties: { info: assistantMessage({ time: { created: 1 }, finish: undefined }) },
    })
    events.push({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_question',
          sessionID: 'ses_1',
          messageID: 'msg_assistant',
          type: 'tool',
          callID: 'call_question_missing',
          tool: 'question',
          state: {
            status: 'running',
            input: {
              questions: [{
                question: 'Should I continue?',
                header: 'Confirm next step',
                options: [
                  { label: 'Continue', description: 'Proceed with the change' },
                  { label: 'Stop', description: 'Do not continue' },
                ],
              }],
            },
            time: { start: 10 },
          },
        } satisfies OpencodePart,
      },
    })

    await expect(firstChunk).resolves.toMatchObject({
      done: false,
      value: { type: 'tool-input-start', toolCallId: 'call_question_missing', toolName: 'question' },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'tool-input-available',
        toolCallId: 'call_question_missing',
      },
    })
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'tool-output-available',
        toolCallId: 'call_question_missing',
      },
    })
    expect(fake.questionList).not.toHaveBeenCalled()
    expect(requestUserInput).not.toHaveBeenCalled()

    events.push({
      id: 'evt_question_asked',
      type: 'question.v2.asked',
      properties: {
        id: 'question-request-race',
        sessionID: 'ses_1',
        questions: [{
          question: 'Should I continue?',
          header: 'Confirm next step',
          options: [
            { label: 'Continue', description: 'Proceed with the change' },
            { label: 'Stop', description: 'Do not continue' },
          ],
        }],
        tool: {
          messageID: 'msg_assistant',
          callID: 'call_question_missing',
        },
      },
    })

    await vi.waitFor(() => expect(requestUserInput).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: 'question-request-race',
      providerMethod: 'question',
      toolCallId: 'call_question_missing',
      questions: [{
        id: 'question-1',
        header: 'Confirm next step',
        question: 'Should I continue?',
        isOther: false,
        isSecret: false,
        multiSelect: false,
        options: [
          { label: 'Continue', description: 'Proceed with the change' },
          { label: 'Stop', description: 'Do not continue' },
        ],
      }],
    })))

    userInputResolver.resolve?.({
      requestId: 'question-request-race',
      answers: { 'question-1': ['Continue'] },
    })
    await vi.waitFor(() => expect(fake.questionReply).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      requestID: 'question-request-race',
      questionV2Reply: {
        answers: [['Continue']],
      },
    }))
    expect(fake.questionReject).not.toHaveBeenCalled()
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'data-runtime-event',
        data: {
          kind: 'opencode.question.v2.asked',
        },
      },
    })
    await stream.return(undefined)
  })
})
