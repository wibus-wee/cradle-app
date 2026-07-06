import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendRuns,
  backendRunSnapshots,
  backendSessionBindings,
  chatSessionQueueItems,
  messages,
  providerTargets,
  sessionEvents,
  sessions,
  workspaces
} from '@cradle/db'
import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import {
  getRuntimeRegistry,
  registerRuntime,
  unregisterRuntime
} from '../src/modules/chat-runtime/chat-runtime-provider-registry'
import type {
  CodexAppServerInvokeInput,
  CodexAppServerInvokeResponse,
  CodexAppServerStreamInput
} from '../src/modules/chat-runtime-providers/codex/app-server/bridge'
import { createCodexGoalContinuation } from '../src/modules/chat-runtime-providers/codex/goal-continuation'
import type {
  ChatRuntime,
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  ExecuteShellCommandInput,
  ExecuteShellCommandResult,
  ForkRuntimeSessionInput,
  GenerateSessionTitleInput,
  ProviderThreadDeleteInput,
  ProviderThreadDeleteResult,
  ProviderThreadListInput,
  ProviderThreadListResult,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RollbackLastTurnInput,
  RollbackLastTurnResult,
  RuntimePresentationCapabilities,
  RuntimeSession,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
  UpdateRuntimeSettingsInput
} from '../src/modules/chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError
} from '../src/modules/chat-runtime/runtime-provider-types'
import {
  flushAllActiveRunSnapshots,
  getActiveRunReplayBufferSummary,
  getActiveSessionRun,
  recoverPersistedRunProjections,
  reportRuntimeSessionTitle,
  updateSessionQueueItem
} from '../src/modules/chat-runtime/runtime'
import {
  cancelQueuedSessionItem,
  claimSessionQueueItem,
  commitSessionEventsInTransaction
} from '../src/modules/chat-runtime/es/commands'
import type { ChatSessionEvent } from '../src/modules/chat-runtime/es/events'
import { providerRuntimeHostManager } from '../src/modules/provider-runtime/host-manager'
import {
  clearSideConversations,
  readSideConversation
} from '../src/modules/provider-runtime/side-conversation-registry'

interface ChatMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  errorText?: string
  content: string
  parentMessageId: string | null
  parentToolCallId?: string | null
  message: {
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>
    metadata?: Record<string, unknown>
  }
}

interface ChatQueueItemView {
  id: string
  sessionId: string
  mode: 'queue'
  status: 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
  text: string
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh' | null
  runtimeSettings: {
    accessMode: 'approval-required' | 'full-access'
    interactionMode: 'default' | 'plan'
  }
  position: number
  startedRunId: string | null
}

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

const TEST_CODEX_RUNTIME_METADATA = {
  label: 'Test Codex',
  providerKinds: ['openai-compatible', 'universal']
} satisfies ChatRuntimeMetadata

const TEST_CODEX_RUNTIME_CAPABILITIES = {
  steer: 'queue-fallback',
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'in-session'
} satisfies ChatRuntimeCapabilities

interface ChatCompletionRequestBody {
  model?: string
  messages: Array<{ role: string; content: string }>
  reasoning_effort?: string
}

function parseChatCompletionRequestBody(
  raw: BodyInit | null | undefined
): ChatCompletionRequestBody {
  const payload = JSON.parse(String(raw)) as ChatCompletionRequestBody
  if (!Array.isArray(payload.messages)) {
    throw new TypeError('Expected OpenAI-compatible chat completion messages')
  }
  return payload
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfileAndSession(
  app: ElysiaApp,
  workspaceId: string,
  ids: {
    providerTargetId: string
    sessionId: string
    providerKind?: 'openai-compatible' | 'anthropic'
    runtimeKind?: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat'
  }
) {
  const credentialRes = await app.handle(
    new Request('http://localhost/secrets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: ids.providerKind ?? 'openai-compatible',
        label: 'Chat Runtime Key',
        secret: 'sk-chat-runtime-test'
      })
    })
  )
  const credential = (await credentialRes.json()) as { id: string }

  const targetRes = await app.handle(
    new Request(`http://localhost/provider-targets/${ids.providerTargetId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Chat Runtime Provider',
        providerKind: ids.providerKind ?? 'openai-compatible',
        enabled: true,
        connectionConfig:
          (ids.providerKind ?? 'openai-compatible') === 'anthropic'
            ? { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' }
            : { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
        credentialRef: credential.id
      })
    })
  )
  expect(targetRes.status).toBe(200)

  const sessionRes = await app.handle(
    new Request('http://localhost/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: ids.sessionId,
        workspaceId,
        title: 'Chat Runtime Session',
        providerTargetId: ids.providerTargetId,
        runtimeKind: ids.runtimeKind
      })
    })
  )
  expect(sessionRes.status).toBe(200)
}

async function waitForMessageStatus(
  app: ElysiaApp,
  sessionId: string,
  expectedStatus: ChatMessageRow['status']
): Promise<ChatMessageRow[]> {
  let latestGroups: ChatMessageRow[] = []
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.handle(
      new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`)
    )
    if (response.status === 200) {
      const groups = (await response.json()) as ChatMessageRow[]
      latestGroups = groups
      const assistant = groups.find((group) => group.role === 'assistant')
      if (assistant?.status === expectedStatus) {
        return groups
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(
    `Timed out waiting for assistant status ${expectedStatus}; latest=${JSON.stringify(latestGroups)}`
  )
}

async function getChatMessages(app: ElysiaApp, sessionId: string): Promise<ChatMessageRow[]> {
  const response = await app.handle(
    new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/messages`)
  )
  expect(response.status).toBe(200)
  return (await response.json()) as ChatMessageRow[]
}

async function waitForCondition<T>(assertion: () => T | Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await assertion()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  throw new Error(
    `Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

async function waitForBackendRunStatus(
  sessionId: string,
  expectedStatus: 'streaming' | 'complete' | 'aborted' | 'failed'
): Promise<typeof backendRuns.$inferSelect> {
  return await waitForCondition(() => {
    const run = db()
      .select()
      .from(backendRuns)
      .where(eq(backendRuns.chatSessionId, sessionId))
      .get()
    expect(run?.status).toBe(expectedStatus)
    return run!
  }, `${sessionId} backend run ${expectedStatus}`)
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = previousValue
  }
}

function queueItemEnqueuedEvent(input: {
  id: string
  sessionId: string
  text: string
  position: number
  createdAt: number
  providerTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | null
  permissionMode?: 'bypassPermissions' | 'plan' | null
  runtimeAccessMode?: 'approval-required' | 'full-access'
  runtimeInteractionMode?: 'default' | 'plan'
}): ChatSessionEvent {
  return {
    type: 'QueueItemEnqueued',
    payload: {
      item: {
        id: input.id,
        sessionId: input.sessionId,
        mode: 'queue',
        status: 'pending',
        text: input.text,
        filesJson: '[]',
        contextPartsJson: '[]',
        providerTargetId: input.providerTargetId ?? null,
        modelId: input.modelId ?? null,
        thinkingEffort: input.thinkingEffort ?? null,
        permissionMode: input.permissionMode ?? null,
        runtimeAccessMode: input.runtimeAccessMode ?? 'approval-required',
        runtimeInteractionMode: input.runtimeInteractionMode ?? 'default',
        position: input.position,
        sourceRunId: null,
        startedRunId: null,
        errorText: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }
    }
  }
}

async function listChatQueue(app: ElysiaApp, sessionId: string): Promise<ChatQueueItemView[]> {
  const response = await app.handle(
    new Request(`http://localhost/chat/sessions/${encodeURIComponent(sessionId)}/queue`)
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { items: ChatQueueItemView[] }
  return body.items
}

function buildSseResponse(chunks: string[], delaysMs?: number[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        let index = 0
        const push = () => {
          if (index >= chunks.length) {
            controller.close()
            return
          }
          controller.enqueue(encoder.encode(chunks[index]))
          const delay = delaysMs?.[index] ?? 0
          index += 1
          setTimeout(push, delay)
        }
        push()
      }
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }
  )
}

async function collectSseChunks(response: Response): Promise<UIMessageChunk[]> {
  const payload = await response.text()
  return payload
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .flatMap((block) => {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n')
      if (data === '[DONE]') {
        return []
      }
      return [JSON.parse(data) as UIMessageChunk]
    })
}

async function readMessageFromUiChunks(chunks: UIMessageChunk[]): Promise<UIMessage | null> {
  let latest: UIMessage | null = null
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })
  for await (const message of readUIMessageStream<UIMessage>({
    message: { id: 'assistant-test', role: 'assistant', parts: [] },
    stream,
    terminateOnError: true
  })) {
    latest = message
  }
  return latest
}

class TestCodexGoalContinuationRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly goalContinuation = createCodexGoalContinuation()
  readonly streamInputs: StreamTurnInput[] = []

  constructor(private readonly options: { failFirstRun?: boolean } = {}) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: 'profile-codex-goal-auto',
      runtimeKind: 'codex',
      providerSessionId: 'codex-thread-goal-auto',
      providerStateSnapshot:
        input.previousProviderStateSnapshot ??
        JSON.stringify({
          models: { currentModelId: null },
          codex: {
            goal: {
              threadId: 'codex-thread-goal-auto',
              objective: 'Keep going',
              status: 'active',
              tokenBudget: null,
              tokensUsed: 0,
              timeUsedSeconds: 0,
              createdAt: 1,
              updatedAt: 2
            }
          }
        })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    if (this.options.failFirstRun && this.streamInputs.length === 1) {
      throw new Error('exceeded retry limit, last status: 429 Too Many Requests')
    }

    input.runtimeSession.providerStateSnapshot = JSON.stringify({
      models: { currentModelId: null },
      codex: {
        goal: {
          threadId: 'codex-thread-goal-auto',
          objective: 'Keep going',
          status: 'complete',
          tokenBudget: null,
          tokensUsed: 1,
          timeUsedSeconds: 1,
          createdAt: 1,
          updatedAt: 3
        }
      }
    })
    yield { type: 'text-start', id: 'continuation-text' }
    yield { type: 'text-delta', id: 'continuation-text', delta: 'Goal continued' }
    yield { type: 'text-end', id: 'continuation-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async cancelTurn(): Promise<void> {}
}

class TestCodexAppServerStreamRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly invokeStarted: Promise<void>
  private resolveInvokeStarted: (() => void) | null = null
  private releaseInvoke: (() => void) | null = null

  constructor() {
    this.invokeStarted = new Promise((resolve) => {
      this.resolveInvokeStarted = resolve
    })
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: 'codex-thread-app-server-stream',
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: 'codex-app-server-initial-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async invokeCodexAppServer(
    input: CodexAppServerInvokeInput
  ): Promise<CodexAppServerInvokeResponse> {
    this.resolveInvokeStarted?.()
    await new Promise<void>((resolve) => {
      this.releaseInvoke = resolve
    })
    input.runtimeSession.providerStateSnapshot = JSON.stringify({
      models: { currentModelId: 'codex-app-server-invoke-model' },
      appServer: { invoked: true }
    })
    return {
      method: input.method,
      capability: {
        method: input.method,
        paramsType: null,
        category: 'thread',
        operation: 'start',
        interaction: 'request'
      },
      result: { ok: true }
    }
  }

  openCodexAppServerStream(input: CodexAppServerStreamInput): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(controller) {
        input.runtimeSession.providerStateSnapshot = JSON.stringify({
          models: { currentModelId: 'codex-app-server-stream-model' },
          appServer: { streamed: true }
        })
        controller.enqueue(encoder.encode('event: result\ndata: {"ok":true}\n\n'))
        controller.close()
      }
    })
  }

  releaseInvokeResponse(): void {
    this.releaseInvoke?.()
  }

  async *streamTurn(): AsyncGenerator<UIMessageChunk, void, void> {}

  async cancelTurn(): Promise<void> {}
}

class TestCodexQuickQuestionRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly quickQuestionInputs: QuickQuestionInput[] = []

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-quick-question-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'codex-quick-question-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async *quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.quickQuestionInputs.push(input)
    yield { type: 'text-start', id: 'quick-question-text' }
    yield { type: 'text-delta', id: 'quick-question-text', delta: `Answer: ${input.question}` }
    yield { type: 'text-end', id: 'quick-question-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async *streamTurn(): AsyncGenerator<UIMessageChunk, void, void> {}

  async cancelTurn(): Promise<void> {}
}

class TestFailingCodexQuickQuestionRuntime extends TestCodexQuickQuestionRuntime {
  override async *quickQuestion(
    input: QuickQuestionInput
  ): AsyncGenerator<UIMessageChunk, void, void> {
    this.quickQuestionInputs.push(input)
    throw new Error('quick question provider failed')
  }
}

class TestCodexTitleGenerationRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-title-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'codex-title-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async generateSessionTitle(_input: GenerateSessionTitleInput): Promise<string | null> {
    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed('codex', 'turn/start', 'model quota exceeded')
    )
  }

  async *streamTurn(): AsyncGenerator<UIMessageChunk, void, void> {
    yield { type: 'text-start', id: 'title-generation-seed-text' }
    yield { type: 'text-delta', id: 'title-generation-seed-text', delta: 'Seed response' }
    yield { type: 'text-end', id: 'title-generation-seed-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async cancelTurn(): Promise<void> {}
}

class TestShellCommandRuntime implements ChatRuntime {
  readonly runtimeKind = 'shell-capable-test' as const
  readonly metadata = {
    ...TEST_CODEX_RUNTIME_METADATA,
    label: 'Shell Capable Test',
    providerKinds: ['openai-compatible'],
  } satisfies ChatRuntimeMetadata
  readonly capabilities = {
    ...TEST_CODEX_RUNTIME_CAPABILITIES,
    supportsShellExecution: true
  } satisfies ChatRuntimeCapabilities

  readonly shellInputs: ExecuteShellCommandInput[] = []

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: 'provider-target-codex-bang-command',
      runtimeKind: this.runtimeKind,
      providerSessionId: 'shell-capable-test-thread-bang-command',
      providerStateSnapshot: JSON.stringify({ models: { currentModelId: 'shell-test-model' } })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async executeShellCommand(input: ExecuteShellCommandInput): Promise<ExecuteShellCommandResult> {
    this.shellInputs.push(input)
    return {
      command: input.command,
      stdout: 'hello from shell capable runtime\n',
      stderr: '',
      exitCode: 0,
      durationMs: 11,
      timedOut: false,
      truncated: false
    }
  }

  async *streamTurn(): AsyncGenerator<UIMessageChunk, void, void> {}

  async cancelTurn(): Promise<void> {}
}

class TestCodexRollbackRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = {
    ...TEST_CODEX_RUNTIME_CAPABILITIES,
    supportsLastTurnRollback: true
  } satisfies ChatRuntimeCapabilities

  readonly rollbackInputs: RollbackLastTurnInput[] = []

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-rollback-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'codex-rollback-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async rollbackLastTurn(input: RollbackLastTurnInput): Promise<RollbackLastTurnResult> {
    this.rollbackInputs.push(input)
    return {
      runtimeKind: 'codex',
      providerSessionId: input.runtimeSession.providerSessionId,
      rolledBackTurns: 1,
      fileChangesReverted: false
    }
  }

  async *streamTurn(): AsyncGenerator<UIMessageChunk, void, void> {}

  async cancelTurn(): Promise<void> {}
}

class TestCodexSkillRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly streamInputs: StreamTurnInput[] = []

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: 'codex-thread-skill',
      providerStateSnapshot: JSON.stringify({ models: { currentModelId: 'codex-test-model' } })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    yield { type: 'text-start', id: 'codex-skill-text' }
    yield { type: 'text-delta', id: 'codex-skill-text', delta: 'Done' }
    yield { type: 'text-end', id: 'codex-skill-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async cancelTurn(): Promise<void> {}
}

class TestCodexSideRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly startInputs: StartChatSessionInput[] = []
  readonly forkInputs: ForkRuntimeSessionInput[] = []
  readonly forkHostSnapshots: ReturnType<typeof providerRuntimeHostManager.listHosts>[] = []
  readonly streamInputs: StreamTurnInput[] = []
  readonly providerThreadListInputs: ProviderThreadListInput[] = []
  readonly providerThreadDeleteInputs: ProviderThreadDeleteInput[] = []
  blockStreams = false
  startWithNullProviderSessionId = false
  assignProviderSessionOnStream = false
  private releaseBlockedStream: (() => void) | null = null

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    this.startInputs.push(input)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: this.startWithNullProviderSessionId
        ? null
        : `codex-thread-started-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'codex-side-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async getPresentation(): Promise<RuntimePresentationCapabilities> {
    return {
      runtimeKind: 'codex',
      slashCommands: [],
      uiSlots: [
        {
          id: 'codex:compact',
          name: 'compact',
          label: 'Compact',
          description: 'Compact this conversation context.',
          argumentHint: '[instructions]',
          aliases: ['summarize'],
          iconKey: 'compact',
          commandText: '/compact ',
          surfaces: ['slashCommand', 'runtimePanel']
        },
        {
          id: 'codex:goal',
          name: 'goal',
          label: 'Goal',
          description: 'Set the active objective.',
          argumentHint: '<objective>',
          aliases: ['objective'],
          iconKey: 'goal',
          commandText: '/goal ',
          surfaces: ['slashCommand', 'composerState', 'runtimePanel']
        }
      ],
      skills: []
    }
  }

  async forkRuntimeSession(input: ForkRuntimeSessionInput): Promise<RuntimeSession> {
    this.forkInputs.push(input)
    this.forkHostSnapshots.push(providerRuntimeHostManager.listHosts())
    return {
      id: input.childChatSessionId,
      chatSessionId: input.childChatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-side-${input.childChatSessionId}`,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'codex-side-model' }
      })
    }
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    if (this.assignProviderSessionOnStream && !input.runtimeSession.providerSessionId) {
      input.runtimeSession.providerSessionId = `codex-thread-stream-${input.runtimeSession.chatSessionId}`
    }
    yield { type: 'text-start', id: 'codex-side-text' }
    yield { type: 'text-delta', id: 'codex-side-text', delta: 'Side response' }
    if (this.blockStreams) {
      await new Promise<void>((resolve) => {
        this.releaseBlockedStream = resolve
      })
    }
    yield { type: 'text-end', id: 'codex-side-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  releaseBlockedStreams(): void {
    this.releaseBlockedStream?.()
    this.releaseBlockedStream = null
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    this.providerThreadListInputs.push(input)
    return {
      runtimeKind: 'codex',
      providerSessionId: input.runtimeSession.providerSessionId,
      threads: [
        {
          id: 'codex-side-thread',
          providerSessionTreeId: input.runtimeSession.providerSessionId,
          forkedFromId: 'codex-thread-side-parent',
          preview: 'Side thread',
          ephemeral: true,
          modelProvider: null,
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_001,
          status: 'idle',
          sourceKind: 'unknown',
          source: null,
          threadSource: null,
          agentNickname: null,
          agentRole: null,
          name: 'Side thread',
          cwd: null
        }
      ],
      nextCursor: null,
      backwardsCursor: null
    }
  }

  async deleteProviderThread(
    input: ProviderThreadDeleteInput
  ): Promise<ProviderThreadDeleteResult> {
    this.providerThreadDeleteInputs.push(input)
    return {
      runtimeKind: 'codex',
      providerSessionId: input.runtimeSession.providerSessionId,
      threadId: input.threadId,
      deleted: true
    }
  }

  async cancelTurn(): Promise<void> {}
}

class TestCodexProtocolChunkRuntime extends TestCodexSideRuntime {
  constructor(private readonly chunks: UIMessageChunk[]) {
    super()
  }

  override async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    for (const chunk of this.chunks) {
      yield chunk
    }
  }
}

class TestProviderSyntheticTurnRuntime implements ChatRuntime {
  readonly runtimeKind = 'claude-agent' as const
  readonly metadata = {
    label: 'Test Claude Synthetic',
    providerKinds: ['anthropic']
  } satisfies ChatRuntimeMetadata

  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly streamInputs: StreamTurnInput[] = []
  readonly syntheticSettled: Promise<void>
  private resolveSyntheticSettled: (() => void) | null = null

  constructor(private readonly syntheticDelayMs = 0) {
    this.syntheticSettled = new Promise((resolve) => {
      this.resolveSyntheticSettled = resolve
    })
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-thread-synthetic',
      providerStateSnapshot: JSON.stringify({ models: { currentModelId: input.modelId ?? null } })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    setTimeout(() => {
      void (async () => {
        await input.onProviderSyntheticTurnEvent?.({
          providerTurnId: 'provider-background-turn-1',
          providerThreadId: 'toolu_background_agent',
          chunks: [
            { type: 'text-start', id: 'provider-background-text' },
            {
              type: 'text-delta',
              id: 'provider-background-text',
              delta: 'Background agent report'
            },
            { type: 'text-end', id: 'provider-background-text' },
            { type: 'finish', finishReason: 'stop' }
          ]
        })
        this.resolveSyntheticSettled?.()
      })()
    }, this.syntheticDelayMs)

    yield { type: 'text-start', id: 'parent-text' }
    yield { type: 'text-delta', id: 'parent-text', delta: 'Parent response' }
    yield { type: 'text-end', id: 'parent-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async cancelTurn(): Promise<void> {}
}

class TestFallbackSideRuntime implements ChatRuntime {
  readonly runtimeKind = 'claude-agent' as const
  readonly metadata = {
    label: 'Test Fallback Side',
    providerKinds: ['anthropic']
  } satisfies ChatRuntimeMetadata

  readonly capabilities = TEST_CODEX_RUNTIME_CAPABILITIES
  readonly startInputs: StartChatSessionInput[] = []
  readonly streamInputs: StreamTurnInput[] = []
  readonly historySnapshots: UIMessage[][] = []

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    this.startInputs.push(input)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'claude-agent',
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'claude-fallback-side-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    this.historySnapshots.push([...(input.history ?? [])])
    const textId = `fallback-side-text-${this.streamInputs.length}`
    yield { type: 'text-start', id: textId }
    yield { type: 'text-delta', id: textId, delta: `Fallback response ${this.streamInputs.length}` }
    yield { type: 'text-end', id: textId }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async cancelTurn(): Promise<void> {}
}

class TestRuntimeSettingsRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = {
    ...TEST_CODEX_RUNTIME_CAPABILITIES,
    supportsRuntimeSettings: true
  } satisfies ChatRuntimeCapabilities

  readonly updateInputs: UpdateRuntimeSettingsInput[] = []
  private releaseStream: (() => void) | null = null
  readonly streamStarted: Promise<void>
  private resolveStreamStarted: (() => void) | null = null

  constructor(private readonly options: { failUpdate?: boolean } = {}) {
    this.streamStarted = new Promise((resolve) => {
      this.resolveStreamStarted = resolve
    })
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-runtime-settings-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? 'codex-runtime-settings-model' }
      })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    this.updateInputs.push(input)
    if (this.options.failUpdate) {
      throw new Error('runtime settings update failed')
    }
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    yield { type: 'text-start', id: 'runtime-settings-text' }
    this.resolveStreamStarted?.()
    await new Promise<void>((resolve) => {
      this.releaseStream = resolve
    })
    yield {
      type: 'text-delta',
      id: 'runtime-settings-text',
      delta: input.providerOptions?.runtimeSettings?.interactionMode ?? 'default'
    }
    yield { type: 'text-end', id: 'runtime-settings-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  release(): void {
    this.releaseStream?.()
  }

  async cancelTurn(): Promise<void> {
    this.release()
  }
}

class TestLiveSteerSnapshotRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = {
    ...TEST_CODEX_RUNTIME_CAPABILITIES,
    steer: 'native'
  } satisfies ChatRuntimeCapabilities

  readonly streamInputs: StreamTurnInput[] = []
  readonly steerInputs: SteerTurnInput[] = []
  private releaseFirstStream: (() => void) | null = null
  readonly firstStreamStarted: Promise<void>
  private resolveFirstStreamStarted: (() => void) | null = null

  constructor() {
    this.firstStreamStarted = new Promise((resolve) => {
      this.resolveFirstStreamStarted = resolve
    })
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-live-steer-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({ models: { currentModelId: input.modelId ?? null } })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    const streamIndex = this.streamInputs.length
    yield { type: 'text-start', id: `live-steer-text-${streamIndex}` }
    if (streamIndex === 1) {
      this.resolveFirstStreamStarted?.()
      await new Promise<void>((resolve) => {
        this.releaseFirstStream = resolve
      })
    }
    yield {
      type: 'text-delta',
      id: `live-steer-text-${streamIndex}`,
      delta: input.providerOptions?.runtimeSettings?.interactionMode ?? 'default'
    }
    yield { type: 'text-end', id: `live-steer-text-${streamIndex}` }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    this.steerInputs.push(input)
  }

  release(): void {
    this.releaseFirstStream?.()
  }

  async cancelTurn(): Promise<void> {
    this.release()
  }
}

class TestPendingRuntimeSettingsRuntime implements ChatRuntime {
  readonly runtimeKind = 'codex' as const
  readonly metadata = TEST_CODEX_RUNTIME_METADATA
  readonly capabilities = {
    ...TEST_CODEX_RUNTIME_CAPABILITIES,
    supportsRuntimeSettings: true
  } satisfies ChatRuntimeCapabilities

  readonly streamInputs: StreamTurnInput[] = []
  readonly updateInputs: UpdateRuntimeSettingsInput[] = []
  cancelCount = 0
  readonly startRequested: Promise<void>
  private resolveStartRequested: (() => void) | null = null
  private releaseStart: (() => void) | null = null

  constructor() {
    this.startRequested = new Promise((resolve) => {
      this.resolveStartRequested = resolve
    })
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    this.resolveStartRequested?.()
    await new Promise<void>((resolve) => {
      this.releaseStart = resolve
    })
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: 'codex',
      providerSessionId: `codex-thread-pending-runtime-settings-${input.chatSessionId}`,
      providerStateSnapshot: JSON.stringify({ models: { currentModelId: input.modelId ?? null } })
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    this.updateInputs.push(input)
  }

  async *streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    this.streamInputs.push(input)
    yield { type: 'text-start', id: 'pending-runtime-settings-text' }
    yield {
      type: 'text-delta',
      id: 'pending-runtime-settings-text',
      delta: input.providerOptions?.runtimeSettings?.interactionMode ?? 'default'
    }
    yield { type: 'text-end', id: 'pending-runtime-settings-text' }
    yield { type: 'finish', finishReason: 'stop' }
  }

  release(): void {
    this.releaseStart?.()
  }

  async cancelTurn(): Promise<void> {
    this.cancelCount += 1
    this.release()
  }
}

describe('chat runtime capability', () => {
  it('ignores trivial provider session titles', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      db()
        .insert(sessions)
        .values({
          id: 'session-provider-title-trivial',
          title: 'Investigate provider switch failure',
          titleSource: 'initial',
          runtimeKind: 'codex'
        })
        .run()

      reportRuntimeSessionTitle({
        sessionId: 'session-provider-title-trivial',
        title: '继续'
      })

      expect(
        db()
          .select({ title: sessions.title, titleSource: sessions.titleSource })
          .from(sessions)
          .where(eq(sessions.id, 'session-provider-title-trivial'))
          .get()
      ).toEqual({
        title: 'Investigate provider switch failure',
        titleSource: 'initial'
      })

      reportRuntimeSessionTitle({
        sessionId: 'session-provider-title-trivial',
        title: 'Provider switch recovery'
      })

      expect(
        db()
          .select({ title: sessions.title, titleSource: sessions.titleSource })
          .from(sessions)
          .where(eq(sessions.id, 'session-provider-title-trivial'))
          .get()
      ).toEqual({
        title: 'Provider switch recovery',
        titleSource: 'provider'
      })
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('serves provider-owned draft runtime capabilities before a session exists', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const response = await app.handle(
        new Request('http://localhost/chat/draft-runtime-capabilities?runtimeKind=codex')
      )
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        runtimeKind: string
        slashCommands: unknown[]
        skills: unknown[]
        uiSlots: Array<{ id: string; name: string; surfaces: string[] }>
      }
      expect(body.runtimeKind).toBe('codex')
      expect(body.slashCommands).toEqual([])
      expect(body.skills).toEqual([])
      expect(body.uiSlots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'codex:goal',
            name: 'goal',
            surfaces: ['slashCommand', 'composerState', 'runtimePanel']
          }),
          expect.objectContaining({
            id: 'codex:compact',
            name: 'compact',
            surfaces: ['slashCommand', 'runtimePanel']
          }),
          expect.objectContaining({
            id: 'codex:review',
            name: 'review',
            surfaces: ['slashCommand']
          })
        ])
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('serves active runtime capabilities before a streaming run persists a durable binding', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    runtime.blockStreams = true
    runtime.startWithNullProviderSessionId = true
    runtime.assignProviderSessionOnStream = true
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runResponsePromise: Promise<Response> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-active-capabilities',
          name: 'Workspace Codex Active Capabilities',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-active-capabilities', {
        providerTargetId: 'provider-target-codex-active-capabilities',
        sessionId: 'session-codex-active-capabilities',
        runtimeKind: 'codex'
      })

      runResponsePromise = app.handle(
        new Request('http://localhost/chat/sessions/session-codex-active-capabilities/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start a long running turn.' })
        })
      )

      await vi.waitFor(() => {
        expect(runtime.streamInputs).toHaveLength(1)
      })
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, 'session-codex-active-capabilities'))
          .get()
      ).toBeUndefined()

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-active-capabilities/capabilities')
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        runtimeKind: string
        uiSlots: Array<{ id: string; name: string; surfaces: string[] }>
      }
      expect(body.runtimeKind).toBe('codex')
      expect(body.uiSlots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'codex:compact',
            name: 'compact',
            surfaces: ['slashCommand', 'runtimePanel']
          }),
          expect.objectContaining({
            id: 'codex:goal',
            name: 'goal',
            surfaces: ['slashCommand', 'composerState', 'runtimePanel']
          })
        ])
      )
    } finally {
      runtime.releaseBlockedStreams()
      if (runResponsePromise) {
        const runResponse = await runResponsePromise.catch(() => null)
        if (runResponse) {
          await collectSseChunks(runResponse).catch(() => undefined)
        }
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('rolls back the last Codex turn through the runtime contract and removes transcript messages', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexRollbackRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-rollback',
          name: 'Workspace Codex Rollback',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-rollback', {
        providerTargetId: 'provider-target-codex-rollback',
        sessionId: 'session-codex-rollback',
        runtimeKind: 'codex'
      })

      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-rollback',
          chatSessionId: 'session-codex-rollback',
          providerTargetId: 'provider-target-codex-rollback',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-rollback',
          backendStateSnapshot: JSON.stringify({
            models: { currentModelId: 'codex-rollback-model' }
          }),
          requestedModelId: 'codex-rollback-model',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000
        })
        .run()

      const userMessage: UIMessage = {
        id: 'message-codex-rollback-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Undo this turn.' }]
      }
      const assistantMessage: UIMessage = {
        id: 'message-codex-rollback-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'This will be removed.' }]
      }
      db()
        .insert(messages)
        .values([
          {
            id: userMessage.id,
            sessionId: 'session-codex-rollback',
            role: 'user',
            status: 'complete',
            content: 'Undo this turn.',
            messageJson: JSON.stringify(userMessage),
            createdAt: 1_700_000_010,
            updatedAt: 1_700_000_010
          },
          {
            id: assistantMessage.id,
            sessionId: 'session-codex-rollback',
            role: 'assistant',
            status: 'complete',
            content: 'This will be removed.',
            messageJson: JSON.stringify(assistantMessage),
            createdAt: 1_700_000_011,
            updatedAt: 1_700_000_011
          }
        ])
        .run()

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-rollback/rollback-last-turn', {
          method: 'POST'
        })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        sessionId: 'session-codex-rollback',
        messageIds: ['message-codex-rollback-user', 'message-codex-rollback-assistant'],
        providerRuntimeKind: 'codex',
        providerSessionId: 'codex-thread-rollback',
        providerRolledBackTurns: 1,
        fileChangesReverted: false
      })
      expect(runtime.rollbackInputs).toHaveLength(1)
      expect(runtime.rollbackInputs[0]?.runtimeSession.providerSessionId).toBe(
        'codex-thread-rollback'
      )
      expect(
        db().select().from(messages).where(eq(messages.sessionId, 'session-codex-rollback')).all()
      ).toEqual([])
      expect(
        db()
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, 'session-codex-rollback'))
          .all()
          .map((event) => event.eventType)
      ).toEqual(['LastTurnRolledBack'])
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('deletes provider-native threads through the session runtime capability', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-provider-thread-delete',
          name: 'Workspace Provider Thread Delete',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-provider-thread-delete', {
        providerTargetId: 'provider-target-provider-thread-delete',
        sessionId: 'session-provider-thread-delete',
        runtimeKind: 'codex'
      })

      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-provider-thread-delete',
          chatSessionId: 'session-provider-thread-delete',
          providerTargetId: 'provider-target-provider-thread-delete',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-provider-thread-delete-parent',
          backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'codex-side-model' } }),
          requestedModelId: 'codex-side-model',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000
        })
        .run()

      const response = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-provider-thread-delete/provider-threads/codex-side-thread',
          {
            method: 'DELETE'
          }
        )
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        runtimeKind: 'codex',
        providerSessionId: 'codex-thread-provider-thread-delete-parent',
        threadId: 'codex-side-thread',
        deleted: true
      })
      expect(runtime.providerThreadDeleteInputs).toHaveLength(1)
      expect(runtime.providerThreadDeleteInputs[0]).toEqual(
        expect.objectContaining({
          threadId: 'codex-side-thread',
          workspaceId: 'workspace-provider-thread-delete',
          workspacePath: workspaceRoot,
          runtimeSession: expect.objectContaining({
            providerSessionId: 'codex-thread-provider-thread-delete-parent'
          })
        })
      )
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('streams quick questions as AI SDK SSE frames', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexQuickQuestionRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-quick-question',
          name: 'Workspace Codex Quick Question',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-quick-question', {
        providerTargetId: 'provider-target-codex-quick-question',
        sessionId: 'session-codex-quick-question',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-quick-question/quick-question', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: 'What is /btw?' })
        })
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const payload = await response.text()
      expect(payload).toContain('data: {"type":"text-start","id":"quick-question-text"}\n\n')
      expect(payload).toContain('data: [DONE]\n\n')

      const replayResponse = new Response(payload, {
        headers: { 'content-type': 'text/event-stream' }
      })
      expect(await collectSseChunks(replayResponse)).toEqual([
        { type: 'text-start', id: 'quick-question-text' },
        { type: 'text-delta', id: 'quick-question-text', delta: 'Answer: What is /btw?' },
        { type: 'text-end', id: 'quick-question-text' },
        { type: 'finish', finishReason: 'stop' }
      ])
      expect(runtime.quickQuestionInputs[0]).toEqual(
        expect.objectContaining({
          question: 'What is /btw?',
          workspaceId: 'workspace-codex-quick-question',
          workspacePath: workspaceRoot
        })
      )
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('streams quick question provider failures as AI SDK error frames', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestFailingCodexQuickQuestionRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-quick-question-error',
          name: 'Workspace Codex Quick Question Error',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-quick-question-error', {
        providerTargetId: 'provider-target-codex-quick-question-error',
        sessionId: 'session-codex-quick-question-error',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-quick-question-error/quick-question',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question: 'Will this fail?' })
          }
        )
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const payload = await response.text()
      expect(payload).toContain(
        'data: {"type":"error","errorText":"quick question provider failed"}\n\n'
      )
      expect(payload).toContain('data: [DONE]\n\n')
      expect(
        await collectSseChunks(
          new Response(payload, { headers: { 'content-type': 'text/event-stream' } })
        )
      ).toEqual([{ type: 'error', errorText: 'quick question provider failed' }])
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('reports Codex session title regeneration provider failures with diagnostics', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexTitleGenerationRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-title-generation-error',
          name: 'Workspace Codex Title Generation Error',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-title-generation-error', {
        providerTargetId: 'provider-target-codex-title-generation-error',
        sessionId: 'session-codex-title-generation-error',
        runtimeKind: 'codex'
      })

      const seedResponse = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-title-generation-error/response',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Name this broken title session.' })
          }
        )
      )
      expect(seedResponse.status).toBe(200)
      await collectSseChunks(seedResponse)
      await waitForMessageStatus(app, 'session-codex-title-generation-error', 'complete')

      const response = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-title-generation-error/title/regenerate',
          {
            method: 'POST'
          }
        )
      )
      expect(response.status).toBe(502)
      const body = (await response.json()) as {
        code: string
        message: string
        details?: {
          reason?: string
          providerError?: { _tag?: string; method?: string; detail?: string }
          error?: { message?: string; stack?: string }
        }
      }
      expect(body).toEqual(
        expect.objectContaining({
          code: 'chat_session_title_generation_failed',
          message: 'Runtime could not generate a session title: model quota exceeded'
        })
      )
      expect(body.details).toEqual(
        expect.objectContaining({
          reason: 'request_failed',
          providerError: expect.objectContaining({
            _tag: 'request_failed',
            method: 'turn/start',
            detail: 'model quota exceeded'
          })
        })
      )
      expect(body.details?.error?.stack).toBeUndefined()

      const flushResponse = await app.handle(
        new Request('http://localhost/observability/flush', { method: 'POST' })
      )
      expect(flushResponse.status).toBe(200)
      const eventsResponse = await app.handle(
        new Request(
          'http://localhost/observability/events?chatSessionId=session-codex-title-generation-error&code=CHAT_SESSION_TITLE_GENERATION_FAILED'
        )
      )
      expect(eventsResponse.status).toBe(200)
      const events = (await eventsResponse.json()) as Array<{
        code: string
        message: string
        attrs?: { reason?: string; providerError?: { method?: string } }
      }>
      expect(events).toEqual([
        expect.objectContaining({
          code: 'CHAT_SESSION_TITLE_GENERATION_FAILED',
          message: 'Runtime could not generate a session title: model quota exceeded',
          attrs: expect.objectContaining({
            reason: 'request_failed',
            providerError: expect.objectContaining({ method: 'turn/start' })
          })
        })
      ])
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('persists Codex app-server stream runtime session mutations when the stream completes', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexAppServerStreamRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-app-server-stream',
          name: 'Workspace Codex App Server Stream',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-app-server-stream', {
        providerTargetId: 'provider-target-codex-app-server-stream',
        sessionId: 'session-codex-app-server-stream',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-app-server-stream/codex/app-server/stream',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method: 'turn/start' })
          }
        )
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('event: result')

      const binding = db()
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.chatSessionId, 'session-codex-app-server-stream'))
        .get()
      expect(binding).toEqual(
        expect.objectContaining({
          providerTargetId: 'provider-target-codex-app-server-stream',
          backendSessionId: 'codex-thread-app-server-stream',
          requestedModelId: 'codex-app-server-stream-model'
        })
      )
      expect(JSON.parse(binding?.backendStateSnapshot ?? '{}')).toEqual({
        models: { currentModelId: 'codex-app-server-stream-model' },
        appServer: { streamed: true }
      })
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('does not restore a deleted provider target when Codex app-server stream persistence finishes', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexAppServerStreamRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-app-server-stream-delete',
          name: 'Workspace Codex App Server Stream Delete',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-app-server-stream-delete', {
        providerTargetId: 'provider-target-codex-app-server-stream-delete',
        sessionId: 'session-codex-app-server-stream-delete',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-app-server-stream-delete/codex/app-server/stream',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method: 'turn/start' })
          }
        )
      )
      expect(response.status).toBe(200)

      const deleteResponse = await app.handle(
        new Request(
          'http://localhost/provider-targets/provider-target-codex-app-server-stream-delete',
          {
            method: 'DELETE'
          }
        )
      )
      expect(deleteResponse.status).toBe(200)
      expect(await response.text()).toContain('event: result')

      const binding = db()
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.chatSessionId, 'session-codex-app-server-stream-delete'))
        .get()
      expect(binding).toEqual(
        expect.objectContaining({
          backendSessionId: 'codex-thread-app-server-stream',
          providerTargetId: null
        })
      )
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('does not restore a deleted provider target when Codex app-server invoke persistence finishes', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexAppServerStreamRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-app-server-invoke-delete',
          name: 'Workspace Codex App Server Invoke Delete',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-app-server-invoke-delete', {
        providerTargetId: 'provider-target-codex-app-server-invoke-delete',
        sessionId: 'session-codex-app-server-invoke-delete',
        runtimeKind: 'codex'
      })

      const responsePromise = app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-app-server-invoke-delete/codex/app-server/invoke',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method: 'thread/read' })
          }
        )
      )
      await runtime.invokeStarted

      const deleteResponse = await app.handle(
        new Request(
          'http://localhost/provider-targets/provider-target-codex-app-server-invoke-delete',
          {
            method: 'DELETE'
          }
        )
      )
      expect(deleteResponse.status).toBe(200)

      runtime.releaseInvokeResponse()
      const response = await responsePromise
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(
        expect.objectContaining({
          method: 'thread/read',
          result: { ok: true }
        })
      )

      const binding = db()
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.chatSessionId, 'session-codex-app-server-invoke-delete'))
        .get()
      expect(binding).toEqual(
        expect.objectContaining({
          backendSessionId: 'codex-thread-app-server-stream',
          providerTargetId: null
        })
      )
    } finally {
      runtime.releaseInvokeResponse()
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('does not add baseline skills to ordinary Codex chat sessions', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSkillRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-skill',
          name: 'Workspace Codex Skill',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-skill', {
        providerTargetId: 'provider-target-codex-skill',
        sessionId: 'session-codex-skill',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-skill/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'List the current Cradle state.' })
        })
      )
      expect(response.status).toBe(200)
      await collectSseChunks(response)

      await waitForMessageStatus(app, 'session-codex-skill', 'complete')

      expect(runtime.streamInputs).toHaveLength(1)
      const runtimeSkillPart = runtime.streamInputs[0]?.message.parts.find(
        (part) => part.type === 'data-cradle-skill'
      )
      expect(runtimeSkillPart).toBeUndefined()

      const rows = await getChatMessages(app, 'session-codex-skill')
      const userRow = rows.find((row) => row.role === 'user')
      const storedSkillPart = userRow?.message.parts.find(
        (part) => part.type === 'data-cradle-skill'
      )
      expect(storedSkillPart).toBeUndefined()
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('accepts Codex plugin mention context parts on ordinary chat responses', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSkillRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    const pluginPart = {
      type: 'data-cradle-plugin',
      provider: 'codex',
      pluginName: 'test-plugin',
      displayName: 'Test Plugin',
      description: 'Test plugin context',
      iconUrl: null,
      routeSegment: 'test-plugin',
      capabilities: [
        {
          id: 'test-plugin:mcp',
          type: 'mcp',
          layer: 'server',
          label: null
        }
      ],
      mcpServers: ['test-server'],
      nativeMention: {
        name: 'test-plugin',
        path: '/Users/test/.codex/plugins/test-plugin'
      },
      position: 0
    }

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-plugin-mention',
          name: 'Workspace Codex Plugin Mention',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-plugin-mention', {
        providerTargetId: 'provider-target-codex-plugin-mention',
        sessionId: 'session-codex-plugin-mention',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-plugin-mention/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Use this plugin.',
            contextParts: [pluginPart]
          })
        })
      )
      expect(response.status).toBe(200)
      await collectSseChunks(response)

      await waitForMessageStatus(app, 'session-codex-plugin-mention', 'complete')

      expect(runtime.streamInputs).toHaveLength(1)
      const runtimePluginPart = runtime.streamInputs[0]?.message.parts.find(
        (part) => part.type === 'data-cradle-plugin'
      )
      expect(runtimePluginPart).toEqual(
        expect.objectContaining({
          type: 'data-cradle-plugin',
          data: expect.objectContaining(pluginPart)
        })
      )

      const rows = await getChatMessages(app, 'session-codex-plugin-mention')
      const userRow = rows.find((row) => row.role === 'user')
      const storedPluginPart = userRow?.message.parts.find(
        (part) => part.type === 'data-cradle-plugin'
      )
      expect(storedPluginPart).toEqual(
        expect.objectContaining({
          type: 'data-cradle-plugin',
          data: expect.objectContaining(pluginPart)
        })
      )
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('keeps provider-native side conversations live-only without durable provider bindings', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-side',
          name: 'Workspace Codex Side',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-side', {
        providerTargetId: 'provider-target-codex-side',
        sessionId: 'session-codex-side-parent',
        runtimeKind: 'codex'
      })

      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-side-parent',
          chatSessionId: 'session-codex-side-parent',
          providerTargetId: 'provider-target-codex-side',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-side-parent',
          backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'codex-side-model' } }),
          requestedModelId: 'codex-side-model',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000
        })
        .run()

      const sideResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-side-parent/side-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(sideResponse.status).toBe(200)
      const side = (await sideResponse.json()) as {
        sideConversationId: string
        parentSessionId: string
        runtimeKind: string
        providerTargetId: string | null
        providerSessionId: string | null
        title: string
      }

      expect(side).toEqual(
        expect.objectContaining({
          parentSessionId: 'session-codex-side-parent',
          runtimeKind: 'codex',
          providerTargetId: 'provider-target-codex-side',
          title: 'Side from Chat Runtime Session'
        })
      )
      expect(runtime.forkInputs).toHaveLength(1)
      expect(runtime.forkInputs[0]?.sourceRuntimeSession.providerSessionId).toBe(
        'codex-thread-side-parent'
      )
      expect(runtime.forkHostSnapshots[0]).toEqual([])
      expect(providerRuntimeHostManager.listHosts()).toEqual([
        expect.objectContaining({
          runtimeKind: 'codex',
          providerTargetId: 'provider-target-codex-side',
          scopeId: side.sideConversationId,
          refCount: 1,
          pinnedCount: 1
        })
      ])
      expect(readSideConversation(side.sideConversationId)?.runtimeSession.providerSessionId).toBe(
        side.providerSessionId
      )
      expect(
        db().select().from(sessions).where(eq(sessions.id, side.sideConversationId)).get()
      ).toBeUndefined()
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, side.sideConversationId))
          .get()
      ).toBeUndefined()

      const runResponse = await app.handle(
        new Request(
          `http://localhost/chat/side-conversations/${side.sideConversationId}/response`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Continue in side.' })
          }
        )
      )
      expect(runResponse.status).toBe(200)
      await collectSseChunks(runResponse)

      expect(runtime.streamInputs).toHaveLength(1)
      expect(runtime.streamInputs[0]?.runtimeSession.providerSessionId).toBe(side.providerSessionId)
      expect(
        db().select().from(messages).where(eq(messages.sessionId, side.sideConversationId)).all()
      ).toEqual([])
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, side.sideConversationId))
          .get()
      ).toBeUndefined()

      const deleteTargetResponse = await app.handle(
        new Request('http://localhost/provider-targets/provider-target-codex-side', {
          method: 'DELETE'
        })
      )
      expect(deleteTargetResponse.status).toBe(200)
      expect(readSideConversation(side.sideConversationId)).toBeUndefined()
      expect(providerRuntimeHostManager.listHosts()).toEqual([])
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      clearSideConversations()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('starts Cradle-owned fallback side chats for runtimes without provider-native fork support', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestFallbackSideRuntime()
    const originalRuntime = getRuntimeRegistry().get('claude-agent')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-fallback-side',
          name: 'Workspace Fallback Side',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-fallback-side', {
        providerTargetId: 'provider-target-fallback-side',
        sessionId: 'session-fallback-side-parent',
        providerKind: 'anthropic',
        runtimeKind: 'claude-agent'
      })

      const parentUserMessage: UIMessage = {
        id: 'parent-user-message',
        role: 'user',
        parts: [{ type: 'text', text: 'Parent context question' }]
      }
      const parentAssistantMessage: UIMessage = {
        id: 'parent-assistant-message',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Parent context answer', state: 'done' }]
      }
      db()
        .insert(messages)
        .values([
          {
            id: parentUserMessage.id,
            sessionId: 'session-fallback-side-parent',
            parentMessageId: null,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'user',
            status: 'complete',
            content: 'Parent context question',
            messageJson: JSON.stringify(parentUserMessage),
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000
          },
          {
            id: parentAssistantMessage.id,
            sessionId: 'session-fallback-side-parent',
            parentMessageId: parentUserMessage.id,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'assistant',
            status: 'complete',
            content: 'Parent context answer',
            messageJson: JSON.stringify(parentAssistantMessage),
            createdAt: 1_700_000_001,
            updatedAt: 1_700_000_001
          }
        ])
        .run()

      const sideResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-fallback-side-parent/side-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(sideResponse.status).toBe(200)
      const side = (await sideResponse.json()) as {
        sideConversationId: string
        parentSessionId: string
        runtimeKind: string
        providerTargetId: string | null
        providerSessionId: string | null
      }

      expect(side).toEqual(
        expect.objectContaining({
          parentSessionId: 'session-fallback-side-parent',
          runtimeKind: 'claude-agent',
          providerTargetId: 'provider-target-fallback-side',
          providerSessionId: null
        })
      )
      expect(runtime.startInputs).toHaveLength(1)
      expect(runtime.startInputs[0]?.chatSessionId).toBe(side.sideConversationId)
      expect(
        readSideConversation(side.sideConversationId)?.history.map((message) => message.id)
      ).toEqual([parentUserMessage.id, parentAssistantMessage.id])

      const firstRunResponse = await app.handle(
        new Request(
          `http://localhost/chat/side-conversations/${side.sideConversationId}/response`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'First side turn' })
          }
        )
      )
      expect(firstRunResponse.status).toBe(200)
      await collectSseChunks(firstRunResponse)

      const secondRunResponse = await app.handle(
        new Request(
          `http://localhost/chat/side-conversations/${side.sideConversationId}/response`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Second side turn' })
          }
        )
      )
      expect(secondRunResponse.status).toBe(200)
      await collectSseChunks(secondRunResponse)

      expect(runtime.streamInputs).toHaveLength(2)
      expect(runtime.historySnapshots[0]?.map((message) => message.id)).toEqual([
        parentUserMessage.id,
        parentAssistantMessage.id
      ])
      expect(runtime.historySnapshots[1]?.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant'
      ])
      expect(
        readSideConversation(side.sideConversationId)?.history.map((message) => message.role)
      ).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
      expect(
        db().select().from(sessions).where(eq(sessions.id, side.sideConversationId)).get()
      ).toBeUndefined()
      expect(
        db().select().from(messages).where(eq(messages.sessionId, side.sideConversationId)).all()
      ).toEqual([])
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, side.sideConversationId))
          .get()
      ).toBeUndefined()
    } finally {
      if (originalRuntime) {
        registerRuntime(originalRuntime)
      }
      clearSideConversations()
      providerRuntimeHostManager.shutdown()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('forks provider-native side chats from a live parent runtime session before durable binding finalization', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    runtime.blockStreams = true
    runtime.startWithNullProviderSessionId = true
    runtime.assignProviderSessionOnStream = true
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runResponsePromise: Promise<Response> | null = null
    let runChunksPromise: Promise<UIMessageChunk[]> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-live-side',
          name: 'Workspace Codex Live Side',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-live-side', {
        providerTargetId: 'provider-target-codex-live-side',
        sessionId: 'session-codex-live-side-parent',
        runtimeKind: 'codex'
      })

      runResponsePromise = app.handle(
        new Request('http://localhost/chat/sessions/session-codex-live-side-parent/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start parent task' })
        })
      )

      await vi.waitFor(() => {
        expect(runtime.streamInputs).toHaveLength(1)
      })
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, 'session-codex-live-side-parent'))
          .get()
      ).toBeUndefined()

      const sideResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-live-side-parent/side-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(sideResponse.status).toBe(200)
      const side = (await sideResponse.json()) as {
        sideConversationId: string
      }

      expect(runtime.forkInputs).toHaveLength(1)
      expect(runtime.forkInputs[0]?.sourceRuntimeSession.providerSessionId).toBe(
        'codex-thread-stream-session-codex-live-side-parent'
      )
      expect(readSideConversation(side.sideConversationId)?.runtimeSession.providerSessionId).toBe(
        `codex-thread-side-${side.sideConversationId}`
      )
    } finally {
      runtime.releaseBlockedStreams()
      if (runResponsePromise) {
        const runResponse = await runResponsePromise.catch(() => null)
        if (runResponse) {
          runChunksPromise = collectSseChunks(runResponse)
        }
      }
      if (runChunksPromise) {
        await runChunksPromise.catch(() => undefined)
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      clearSideConversations()
      providerRuntimeHostManager.clear()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('rejects expired provider-native side conversations instead of starting an empty provider session', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-side-expired',
          name: 'Workspace Codex Side Expired',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-side-expired', {
        providerTargetId: 'provider-target-codex-side-expired',
        sessionId: 'session-codex-side-expired-parent',
        runtimeKind: 'codex'
      })

      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-side-expired-parent',
          chatSessionId: 'session-codex-side-expired-parent',
          providerTargetId: 'provider-target-codex-side-expired',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-side-expired-parent',
          backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'codex-side-model' } }),
          requestedModelId: 'codex-side-model',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000
        })
        .run()

      const sideResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-side-expired-parent/side-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(sideResponse.status).toBe(200)
      const side = (await sideResponse.json()) as { sideConversationId: string }
      expect(readSideConversation(side.sideConversationId)).toBeDefined()

      clearSideConversations()
      providerRuntimeHostManager.shutdown()

      const runResponse = await app.handle(
        new Request(
          `http://localhost/chat/side-conversations/${side.sideConversationId}/response`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Continue after side host expired.' })
          }
        )
      )
      expect(runResponse.status).toBe(410)
      expect(await runResponse.json()).toEqual(
        expect.objectContaining({
          code: 'side_chat_expired'
        })
      )
      expect(runtime.startInputs).toHaveLength(0)
      expect(runtime.streamInputs).toHaveLength(0)
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      clearSideConversations()
      providerRuntimeHostManager.shutdown()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('releases provider-native side conversations when parents are archived or side tabs are closed', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-side-close',
          name: 'Workspace Codex Side Close',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-side-close', {
        providerTargetId: 'provider-target-codex-side-close',
        sessionId: 'session-codex-side-close-parent',
        runtimeKind: 'codex'
      })

      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-side-close-parent',
          chatSessionId: 'session-codex-side-close-parent',
          providerTargetId: 'provider-target-codex-side-close',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-side-close-parent',
          backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'codex-side-model' } }),
          requestedModelId: 'codex-side-model',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000
        })
        .run()

      const archivedSideResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-side-close-parent/side-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(archivedSideResponse.status).toBe(200)
      const archivedSide = (await archivedSideResponse.json()) as { sideConversationId: string }
      expect(readSideConversation(archivedSide.sideConversationId)).toBeDefined()

      const archiveResponse = await app.handle(
        new Request('http://localhost/sessions/session-codex-side-close-parent/archive', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: true })
        })
      )
      expect(archiveResponse.status).toBe(200)
      expect(readSideConversation(archivedSide.sideConversationId)).toBeUndefined()
      expect(
        providerRuntimeHostManager
          .listHosts()
          .some((host) => host.scopeId === archivedSide.sideConversationId)
      ).toBe(false)

      await app.handle(
        new Request('http://localhost/sessions/session-codex-side-close-parent/archive', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: false })
        })
      )

      const deletedSideResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-side-close-parent/side-chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(deletedSideResponse.status).toBe(200)
      const deletedSide = (await deletedSideResponse.json()) as { sideConversationId: string }
      expect(readSideConversation(deletedSide.sideConversationId)).toBeDefined()

      const deleteResponse = await app.handle(
        new Request(`http://localhost/chat/side-conversations/${deletedSide.sideConversationId}`, {
          method: 'DELETE'
        })
      )
      expect(deleteResponse.status).toBe(200)
      expect(readSideConversation(deletedSide.sideConversationId)).toBeUndefined()
      expect(
        providerRuntimeHostManager
          .listHosts()
          .some((host) => host.scopeId === deletedSide.sideConversationId)
      ).toBe(false)
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      clearSideConversations()
      providerRuntimeHostManager.shutdown()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('rejects runtime-incompatible provider combinations during session creation', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-incompatible',
          name: 'Workspace Chat Incompatible',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      const credentialRes = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'OpenAI Key',
            secret: 'sk-openai-test'
          })
        })
      )
      const credential = (await credentialRes.json()) as { id: string }

      const targetRes = await app.handle(
        new Request('http://localhost/provider-targets/provider-target-openai', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            displayName: 'OpenAI Provider',
            providerKind: 'openai-compatible',
            enabled: true,
            connectionConfig: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
            credentialRef: credential.id
          })
        })
      )
      expect(targetRes.status).toBe(200)

      const sessionRes = await app.handle(
        new Request('http://localhost/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: 'session-incompatible',
            workspaceId: 'workspace-chat-incompatible',
            title: 'Claude Session',
            providerTargetId: 'provider-target-openai',
            runtimeKind: 'claude-agent'
          })
        })
      )

      expect(sessionRes.status).toBe(400)
      expect(await sessionRes.json()).toEqual(
        expect.objectContaining({
          code: 'invalid_session_input'
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('runs an openai-compatible turn, writes message snapshots and usage, and makes assistant text searchable', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = parseChatCompletionRequestBody(init?.body)
        expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Explain server runtime' })
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"from chat runtime"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      // models.dev or other external calls — return empty JSON so registry caches it
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat',
          name: 'Workspace Chat',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat', {
        providerTargetId: 'provider-target-chat',
        sessionId: 'session-chat'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Explain server runtime', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat', 'complete')
      expect(rows).toHaveLength(2)
      const userMessage = rows.find((row) => row.role === 'user')
      const assistantMessage = rows.find((row) => row.role === 'assistant')
      expect(userMessage).toEqual(
        expect.objectContaining({ content: 'Explain server runtime', status: 'complete' })
      )
      expect(assistantMessage).toEqual(
        expect.objectContaining({ content: 'Hello from chat runtime', status: 'complete' })
      )
      expect(assistantMessage?.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: 'Hello from chat runtime' })
        ])
      )

      const usageRes = await app.handle(new Request('http://localhost/usage/sessions/session-chat'))
      expect(usageRes.status).toBe(200)
      expect(await usageRes.json()).toEqual(
        expect.objectContaining({
          promptTokens: 10,
          completionTokens: 3,
          totalTokens: 13
        })
      )

      const searchRes = await app.handle(
        new Request('http://localhost/search/threads?query=Hello%20from%20chat%20runtime')
      )
      expect(searchRes.status).toBe(200)
      const hits = (await searchRes.json()) as Array<{ sessionId: string }>
      expect(hits).toEqual([expect.objectContaining({ sessionId: 'session-chat' })])
      expect(
        fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))
      ).toHaveLength(1)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('keeps active runtime settings unchanged when live runtime update fails', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestRuntimeSettingsRuntime({ failUpdate: true })
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runChunksPromise: Promise<UIMessageChunk[]> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-runtime-settings-failure',
          name: 'Workspace Runtime Settings Failure',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-runtime-settings-failure', {
        providerTargetId: 'provider-target-runtime-settings-failure',
        sessionId: 'session-runtime-settings-failure',
        runtimeKind: 'codex'
      })

      const initialSettingsRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-runtime-settings-failure/runtime-settings'
        )
      )
      expect(initialSettingsRes.status).toBe(200)
      expect(await initialSettingsRes.json()).toEqual({
        sessionId: 'session-runtime-settings-failure',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
        claudeAgent: null,
        applied: true
      })

      const idlePatchRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-runtime-settings-failure/runtime-settings',
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessMode: 'full-access', interactionMode: 'default' })
          }
        )
      )
      expect(idlePatchRes.status).toBe(200)
      expect(await idlePatchRes.json()).toEqual({
        sessionId: 'session-runtime-settings-failure',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
        claudeAgent: null,
        applied: true
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-runtime-settings-failure/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Keep this run active.' })
        })
      )
      expect(runRes.status).toBe(200)
      runChunksPromise = collectSseChunks(runRes)
      await runtime.streamStarted

      const patchRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-runtime-settings-failure/runtime-settings',
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessMode: 'approval-required', interactionMode: 'plan' })
          }
        )
      )
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual({
        sessionId: 'session-runtime-settings-failure',
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
        claudeAgent: null,
        applied: false
      })
      expect(runtime.updateInputs).toHaveLength(1)

      const unappliedSettingsRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-runtime-settings-failure/runtime-settings'
        )
      )
      expect(unappliedSettingsRes.status).toBe(200)
      expect(await unappliedSettingsRes.json()).toEqual({
        sessionId: 'session-runtime-settings-failure',
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
        claudeAgent: null,
        applied: false
      })

      const persistedSettings = JSON.parse(
        db()
          .select({ configJson: sessions.configJson })
          .from(sessions)
          .where(eq(sessions.id, 'session-runtime-settings-failure'))
          .get()!.configJson ?? '{}'
      ) as { runtimeSettings?: unknown }
      expect(persistedSettings.runtimeSettings).toEqual({
        accessMode: 'approval-required',
        interactionMode: 'plan'
      })

      const statusRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-runtime-settings-failure/runtime-status'
        )
      )
      expect(statusRes.status).toBe(200)
      expect(await statusRes.json()).toEqual(
        expect.objectContaining({
          status: 'streaming',
          runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
          activeRun: expect.objectContaining({
            runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' }
          })
        })
      )

      runtime.release()
      await runChunksPromise
      await waitForMessageStatus(app, 'session-runtime-settings-failure', 'complete')

      const completedSettingsRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-runtime-settings-failure/runtime-settings'
        )
      )
      expect(completedSettingsRes.status).toBe(200)
      expect(await completedSettingsRes.json()).toEqual({
        sessionId: 'session-runtime-settings-failure',
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
        claudeAgent: null,
        applied: true
      })
    } finally {
      runtime.release()
      if (runChunksPromise) {
        await runChunksPromise.catch(() => undefined)
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('persists Claude Agent model matrix overrides in chat session runtime settings', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-claude-matrix-settings',
          name: 'Workspace Claude Matrix Settings',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-claude-matrix-settings', {
        providerTargetId: 'provider-target-claude-matrix-settings',
        sessionId: 'session-claude-matrix-settings',
        providerKind: 'anthropic',
        runtimeKind: 'claude-agent'
      })

      const initialSettingsRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-claude-matrix-settings/runtime-settings'
        )
      )
      expect(initialSettingsRes.status).toBe(200)
      expect(await initialSettingsRes.json()).toEqual({
        sessionId: 'session-claude-matrix-settings',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
        claudeAgent: null,
        applied: true
      })

      const patchRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-claude-matrix-settings/runtime-settings',
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              claudeAgent: {
                modelAliases: {
                  haiku: ' claude-haiku-session ',
                  sonnet: 'claude-sonnet-session',
                  opus: 'claude-opus-session'
                }
              }
            })
          }
        )
      )
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual({
        sessionId: 'session-claude-matrix-settings',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
        claudeAgent: {
          modelAliases: {
            haiku: 'claude-haiku-session',
            sonnet: 'claude-sonnet-session',
            opus: 'claude-opus-session'
          }
        },
        applied: true
      })

      const persistedSettings = JSON.parse(
        db()
          .select({ configJson: sessions.configJson })
          .from(sessions)
          .where(eq(sessions.id, 'session-claude-matrix-settings'))
          .get()!.configJson ?? '{}'
      ) as { claudeAgent?: unknown; runtimeSettings?: unknown }
      expect(persistedSettings.claudeAgent).toEqual({
        modelAliases: {
          haiku: 'claude-haiku-session',
          sonnet: 'claude-sonnet-session',
          opus: 'claude-opus-session'
        }
      })
      expect(persistedSettings.runtimeSettings).toEqual({
        accessMode: 'full-access',
        interactionMode: 'default'
      })

      const clearRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-claude-matrix-settings/runtime-settings',
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              claudeAgent: {
                modelAliases: {
                  haiku: '',
                  sonnet: '   ',
                  opus: ''
                }
              }
            })
          }
        )
      )
      expect(clearRes.status).toBe(200)
      expect(await clearRes.json()).toEqual({
        sessionId: 'session-claude-matrix-settings',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
        claudeAgent: null,
        applied: true
      })
      const clearedSettings = JSON.parse(
        db()
          .select({ configJson: sessions.configJson })
          .from(sessions)
          .where(eq(sessions.id, 'session-claude-matrix-settings'))
          .get()!.configJson ?? '{}'
      ) as { claudeAgent?: unknown }
      expect(clearedSettings.claudeAgent).toBeUndefined()
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('reports runtime settings as unapplied while a run is still starting', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestPendingRuntimeSettingsRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runChunksPromise: Promise<UIMessageChunk[]> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-pending-runtime-settings',
          name: 'Workspace Pending Runtime Settings',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-pending-runtime-settings', {
        providerTargetId: 'provider-target-pending-runtime-settings',
        sessionId: 'session-pending-runtime-settings',
        runtimeKind: 'codex'
      })

      const runResPromise = app.handle(
        new Request('http://localhost/chat/sessions/session-pending-runtime-settings/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start slowly.' })
        })
      )
      await runtime.startRequested

      const patchRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-pending-runtime-settings/runtime-settings',
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessMode: 'approval-required', interactionMode: 'plan' })
          }
        )
      )
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual({
        sessionId: 'session-pending-runtime-settings',
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
        claudeAgent: null,
        applied: false
      })

      const settingsRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-pending-runtime-settings/runtime-settings'
        )
      )
      expect(settingsRes.status).toBe(200)
      expect(await settingsRes.json()).toEqual({
        sessionId: 'session-pending-runtime-settings',
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
        claudeAgent: null,
        applied: false
      })

      runtime.release()
      const runRes = await runResPromise
      expect(runRes.status).toBe(200)
      runChunksPromise = collectSseChunks(runRes)
      await runChunksPromise
      await waitForMessageStatus(app, 'session-pending-runtime-settings', 'complete')

      expect(runtime.streamInputs[0]?.providerOptions?.runtimeSettings).toEqual({
        accessMode: 'full-access',
        interactionMode: 'default'
      })

      const completedSettingsRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-pending-runtime-settings/runtime-settings'
        )
      )
      expect(completedSettingsRes.status).toBe(200)
      expect(await completedSettingsRes.json()).toEqual({
        sessionId: 'session-pending-runtime-settings',
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
        claudeAgent: null,
        applied: true
      })
    } finally {
      runtime.release()
      if (runChunksPromise) {
        await runChunksPromise.catch(() => undefined)
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('fails cleanly when the provider target is deleted while a run is still starting', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestPendingRuntimeSettingsRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-pending-provider-target-delete',
          name: 'Workspace Pending Provider Target Delete',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-pending-provider-target-delete', {
        providerTargetId: 'provider-target-pending-delete',
        sessionId: 'session-pending-provider-target-delete',
        runtimeKind: 'codex'
      })

      const runResPromise = app.handle(
        new Request(
          'http://localhost/chat/sessions/session-pending-provider-target-delete/response',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Start while the target disappears.' })
          }
        )
      )
      await runtime.startRequested

      const deleteRes = await app.handle(
        new Request('http://localhost/provider-targets/provider-target-pending-delete', {
          method: 'DELETE'
        })
      )
      expect(deleteRes.status).toBe(200)

      runtime.release()
      const runRes = await runResPromise
      expect(runRes.status).toBe(409)
      expect(await runRes.json()).toEqual(
        expect.objectContaining({
          code: 'chat_provider_target_not_available'
        })
      )
      expect(runtime.cancelCount).toBe(1)
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, 'session-pending-provider-target-delete'))
          .all()
      ).toHaveLength(0)
      expect(
        db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-pending-provider-target-delete'))
          .all()
      ).toHaveLength(0)
    } finally {
      runtime.release()
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('auto-falls back to queueing a live steer when its provider target differs from the active run', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestLiveSteerSnapshotRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runChunksPromise: Promise<UIMessageChunk[]> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-live-steer-snapshot',
          name: 'Workspace Live Steer Snapshot',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-live-steer-snapshot', {
        providerTargetId: 'provider-target-live-steer-snapshot',
        sessionId: 'session-live-steer-snapshot',
        runtimeKind: 'codex'
      })
      const otherCredentialRes = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Other Live Steer Provider Key',
            secret: 'sk-other-live-steer-test'
          })
        })
      )
      const otherCredential = (await otherCredentialRes.json()) as { id: string }
      const otherTargetRes = await app.handle(
        new Request('http://localhost/provider-targets/provider-target-live-steer-other', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            displayName: 'Other Live Steer Provider',
            providerKind: 'openai-compatible',
            enabled: true,
            connectionConfig: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
            credentialRef: otherCredential.id
          })
        })
      )
      expect(otherTargetRes.status).toBe(200)

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-live-steer-snapshot/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Keep the first run active.',
            modelId: 'codex-live-model',
            runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' }
          })
        })
      )
      expect(runRes.status).toBe(200)
      runChunksPromise = collectSseChunks(runRes)
      await runtime.firstStreamStarted

      const steerRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-live-steer-snapshot/steer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Use a different provider target.',
            providerTargetId: 'provider-target-live-steer-other'
          })
        })
      )
      expect(steerRes.status).toBe(200)
      expect(await steerRes.json()).toEqual(
        expect.objectContaining({
          mode: 'queued',
          ok: true,
          sessionId: 'session-live-steer-snapshot'
        })
      )
      expect(runtime.steerInputs).toHaveLength(0)
      expect(await listChatQueue(app, 'session-live-steer-snapshot')).toHaveLength(1)

      runtime.release()
      await runChunksPromise

      await waitForCondition(() => {
        expect(runtime.streamInputs).toHaveLength(2)
      }, 'snapshot-mismatched steer item to drain onto the next run')
      expect(runtime.steerInputs).toHaveLength(0)
      const drainedQueue = await listChatQueue(app, 'session-live-steer-snapshot')
      expect(drainedQueue).toEqual([
        expect.objectContaining({
          mode: 'queue',
          status: 'completed',
          text: 'Use a different provider target.',
          providerTargetId: 'provider-target-live-steer-other',
          startedRunId: expect.any(String)
        })
      ])
    } finally {
      runtime.release()
      if (runChunksPromise) {
        await runChunksPromise.catch(() => undefined)
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('accepts live steer when model, thinking effort, and runtime settings change on the same provider target', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestLiveSteerSnapshotRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runChunksPromise: Promise<UIMessageChunk[]> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-live-steer-thinking-effort',
          name: 'Workspace Live Steer Thinking Effort',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-live-steer-thinking-effort', {
        providerTargetId: 'provider-target-live-steer-thinking-effort',
        sessionId: 'session-live-steer-thinking-effort',
        runtimeKind: 'codex'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-live-steer-thinking-effort/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Keep the run active with high effort.',
            modelId: 'codex-live-model',
            thinkingEffort: 'high',
            runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' }
          })
        })
      )
      expect(runRes.status).toBe(200)
      runChunksPromise = collectSseChunks(runRes)
      await runtime.firstStreamStarted

      const steerRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-live-steer-thinking-effort/steer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Apply live guidance after changing composer run settings.',
            modelId: 'codex-next-run-model',
            thinkingEffort: 'xhigh',
            runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' }
          })
        })
      )
      expect(steerRes.status).toBe(200)
      expect(await steerRes.json()).toEqual(
        expect.objectContaining({
          ok: true,
          sessionId: 'session-live-steer-thinking-effort'
        })
      )
      expect(runtime.steerInputs).toHaveLength(1)
      expect(await listChatQueue(app, 'session-live-steer-thinking-effort')).toEqual([])

      runtime.release()
      await runChunksPromise
    } finally {
      runtime.release()
      if (runChunksPromise) {
        await runChunksPromise.catch(() => undefined)
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('uses stored queue runtime defaults for historical rows instead of current session settings', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestLiveSteerSnapshotRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-historical-queue-runtime-settings',
          name: 'Workspace Historical Queue Runtime Settings',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-historical-queue-runtime-settings', {
        providerTargetId: 'provider-target-historical-queue-runtime-settings',
        sessionId: 'session-historical-queue-runtime-settings',
        runtimeKind: 'codex'
      })

      const patchRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-historical-queue-runtime-settings/runtime-settings',
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessMode: 'approval-required', interactionMode: 'plan' })
          }
        )
      )
      expect(patchRes.status).toBe(200)

      const now = Math.floor(Date.now() / 1000)
      commitSessionEventsInTransaction('session-historical-queue-runtime-settings', [
        queueItemEnqueuedEvent({
          id: 'queue-historical-default-runtime-settings',
          sessionId: 'session-historical-queue-runtime-settings',
          text: 'Use historical defaults.',
          position: 1,
          createdAt: now,
          runtimeAccessMode: 'full-access',
          runtimeInteractionMode: 'default'
        }),
        queueItemEnqueuedEvent({
          id: 'queue-historical-plan-runtime-settings',
          sessionId: 'session-historical-queue-runtime-settings',
          text: 'Use historical plan mode.',
          position: 2,
          createdAt: now,
          permissionMode: 'plan',
          runtimeAccessMode: 'approval-required',
          runtimeInteractionMode: 'plan'
        })
      ])

      const visibleQueue = await listChatQueue(app, 'session-historical-queue-runtime-settings')
      expect(
        visibleQueue.find((item) => item.id === 'queue-historical-default-runtime-settings')
      ).toEqual(
        expect.objectContaining({
          runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' }
        })
      )
      expect(
        visibleQueue.find((item) => item.id === 'queue-historical-plan-runtime-settings')
      ).toEqual(
        expect.objectContaining({
          runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' }
        })
      )

      const triggerRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-historical-queue-runtime-settings/queue',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Trigger drain.' })
          }
        )
      )
      expect(triggerRes.status).toBe(200)

      await waitForCondition(() => {
        expect(runtime.streamInputs).toHaveLength(1)
      }, 'first historical queue item to start')
      runtime.release()
      await waitForCondition(() => {
        expect(runtime.streamInputs).toHaveLength(3)
      }, 'historical queue items to drain')

      expect(runtime.streamInputs.map((input) => input.providerOptions?.runtimeSettings)).toEqual([
        { accessMode: 'full-access', interactionMode: 'default' },
        { accessMode: 'approval-required', interactionMode: 'plan' },
        { accessMode: 'approval-required', interactionMode: 'plan' }
      ])
    } finally {
      runtime.release()
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('maps selected thinking effort to OpenAI reasoning effort', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    const completionPayloads: ChatCompletionRequestBody[] = []

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = parseChatCompletionRequestBody(init?.body)
        completionPayloads.push(payload)
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-5","choices":[{"index":0,"delta":{"content":"Reasoned"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-thinking',
          name: 'Workspace Chat Thinking',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-thinking', {
        providerTargetId: 'provider-target-chat-thinking',
        sessionId: 'session-chat-thinking'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-thinking/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Use high reasoning.',
            modelId: 'gpt-5',
            thinkingEffort: 'high'
          })
        })
      )
      expect(runRes.status).toBe(200)
      await waitForMessageStatus(app, 'session-chat-thinking', 'complete')

      expect(completionPayloads).toHaveLength(1)
      expect(completionPayloads[0]).toEqual(
        expect.objectContaining({
          model: 'gpt-5',
          reasoning_effort: 'high'
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      fetchSpy.mockRestore()
    }
  })

  it('keeps chat history and queue readable after deleting the provider target', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-provider-deleted',
          name: 'Workspace Chat Provider Deleted',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-provider-deleted', {
        providerTargetId: 'provider-target-chat-deleted',
        sessionId: 'session-chat-provider-deleted'
      })

      const now = Math.floor(Date.now() / 1000)
      const userMessage: UIMessage = {
        id: 'message-provider-deleted-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Keep this history readable.' }]
      }
      const assistantMessage: UIMessage = {
        id: 'message-provider-deleted-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'History remains available.' }]
      }

      db()
        .insert(messages)
        .values([
          {
            id: userMessage.id,
            sessionId: 'session-chat-provider-deleted',
            role: 'user',
            status: 'complete',
            content: 'Keep this history readable.',
            messageJson: JSON.stringify(userMessage),
            createdAt: now,
            updatedAt: now
          },
          {
            id: assistantMessage.id,
            sessionId: 'session-chat-provider-deleted',
            role: 'assistant',
            status: 'complete',
            content: 'History remains available.',
            messageJson: JSON.stringify(assistantMessage),
            createdAt: now + 1,
            updatedAt: now + 1
          }
        ])
        .run()
      db()
        .insert(chatSessionQueueItems)
        .values({
          id: 'queue-provider-deleted',
          sessionId: 'session-chat-provider-deleted',
          mode: 'queue',
          status: 'pending',
          text: 'Queued before provider deletion.',
          providerTargetId: 'provider-target-chat-deleted',
          position: 1,
          createdAt: now,
          updatedAt: now
        })
        .run()

      const deleteRes = await app.handle(
        new Request('http://localhost/provider-targets/provider-target-chat-deleted', {
          method: 'DELETE'
        })
      )
      expect(deleteRes.status).toBe(200)

      const session = db()
        .select()
        .from(sessions)
        .where(eq(sessions.id, 'session-chat-provider-deleted'))
        .get()
      expect(session?.providerTargetId).toBeNull()

      const messagesRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-provider-deleted/messages')
      )
      expect(messagesRes.status).toBe(200)
      const messageRows = (await messagesRes.json()) as ChatMessageRow[]
      expect(messageRows).toEqual([
        expect.objectContaining({
          messageId: userMessage.id,
          content: 'Keep this history readable.'
        }),
        expect.objectContaining({
          messageId: assistantMessage.id,
          content: 'History remains available.'
        })
      ])

      const queueRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-provider-deleted/queue')
      )
      expect(queueRes.status).toBe(200)
      expect(await queueRes.json()).toEqual({
        items: [
          expect.objectContaining({
            id: 'queue-provider-deleted',
            providerTargetId: null,
            text: 'Queued before provider deletion.'
          })
        ]
      })

      const capabilitiesRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-provider-deleted/capabilities')
      )
      expect(capabilitiesRes.status).toBe(200)
      expect(await capabilitiesRes.json()).toEqual({
        runtimeKind: 'standard',
        slashCommands: [],
        uiSlots: [],
        skills: []
      })
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('builds provider turn history from bounded content instead of parsing large stored snapshots', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousMaxMessages = process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES
    const previousMaxChars = process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES = '2'
    process.env.CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS = '80'
    const completionPayloads: ChatCompletionRequestBody[] = []

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        completionPayloads.push(payload)
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"bounded"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":1,"total_tokens":8}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-bounded-history',
          name: 'Workspace Chat Bounded History',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-bounded-history', {
        providerTargetId: 'provider-target-chat-bounded-history',
        sessionId: 'session-chat-bounded-history'
      })

      const hugeSnapshot = JSON.stringify({
        id: 'message-bounded-history-old',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'x'.repeat(250_000) },
          { type: 'text', text: 'Old large snapshot text should not be parsed.' }
        ]
      })
      db()
        .insert(messages)
        .values([
          {
            id: 'message-bounded-history-old',
            sessionId: 'session-chat-bounded-history',
            parentMessageId: null,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'assistant',
            status: 'complete',
            content: 'Old content outside the bounded message window.',
            messageJson: hugeSnapshot,
            errorText: null,
            createdAt: 1700000000,
            updatedAt: 1700000000
          },
          {
            id: 'message-bounded-history-user',
            sessionId: 'session-chat-bounded-history',
            parentMessageId: null,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'user',
            status: 'complete',
            content: 'Recent user content from row cache.',
            messageJson: '{',
            errorText: null,
            createdAt: 1700000001,
            updatedAt: 1700000001
          },
          {
            id: 'message-bounded-history-assistant',
            sessionId: 'session-chat-bounded-history',
            parentMessageId: null,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'assistant',
            status: 'complete',
            content: 'Recent assistant content from row cache.',
            messageJson: '{',
            errorText: null,
            createdAt: 1700000002,
            updatedAt: 1700000002
          }
        ])
        .run()

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-bounded-history/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Use bounded history now.', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)
      await waitForBackendRunStatus('session-chat-bounded-history', 'complete')

      const payload = completionPayloads[0]
      expect(payload?.messages.slice(-3)).toEqual([
        { role: 'user', content: 'Recent user content from row cache.' },
        { role: 'assistant', content: 'Recent assistant content from row cache.' },
        { role: 'user', content: 'Use bounded history now.' }
      ])
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      restoreEnv('CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES', previousMaxMessages)
      restoreEnv('CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS', previousMaxChars)
      fetchSpy.mockRestore()
    }
  })

  it('compacts oversized stored snapshots in hydrated message DTOs without mutating storage', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousRepairMin = process.env.CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS
    const previousTextLimit = process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS = '1'
    process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '24'

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-repair-snapshot',
          name: 'Workspace Chat Repair Snapshot',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-repair-snapshot', {
        providerTargetId: 'provider-target-chat-repair-snapshot',
        sessionId: 'session-chat-repair-snapshot'
      })

      const originalSnapshot = JSON.stringify({
        id: 'message-repair-snapshot-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: `oversized assistant text ${'x'.repeat(2_000)}` }]
      })
      db()
        .insert(messages)
        .values({
          id: 'message-repair-snapshot-assistant',
          sessionId: 'session-chat-repair-snapshot',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'complete',
          content: `oversized assistant text ${'x'.repeat(2_000)}`,
          messageJson: originalSnapshot,
          errorText: null,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()

      const messageRows = await getChatMessages(app, 'session-chat-repair-snapshot')
      expect(messageRows[0]?.message.parts.find((part) => part.type === 'text')?.text).toBe(
        'oversized assistant text'
      )
      expect(messageRows[0]?.content).toBe('oversized assistant text')

      const storedRow = db()
        .select()
        .from(messages)
        .where(eq(messages.id, 'message-repair-snapshot-assistant'))
        .get()
      expect(storedRow?.messageJson).toBe(originalSnapshot)
      expect(storedRow?.content).toBe(`oversized assistant text ${'x'.repeat(2_000)}`)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
      restoreEnv('CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS', previousRepairMin)
      restoreEnv('CRADLE_CHAT_STORED_TEXT_MAX_CHARS', previousTextLimit)
      vi.restoreAllMocks()
    }
  })

  it('allows switching chat sessions to another compatible provider profile', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Switch provider please' })
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"Switched provider"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4.1-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":6,"completion_tokens":2,"total_tokens":8}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-switch',
          name: 'Workspace Chat Switch',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-switch', {
        providerTargetId: 'provider-target-chat-primary',
        sessionId: 'session-chat-switch',
        providerKind: 'openai-compatible',
        runtimeKind: 'standard'
      })

      const secondaryCredentialRes = await app.handle(
        new Request('http://localhost/secrets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'openai-compatible',
            label: 'Secondary Key',
            secret: 'sk-secondary-test'
          })
        })
      )
      const secondaryCredential = (await secondaryCredentialRes.json()) as { id: string }

      const secondaryTargetRes = await app.handle(
        new Request('http://localhost/provider-targets/provider-target-chat-secondary', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            displayName: 'Secondary OpenAI Provider',
            providerKind: 'openai-compatible',
            enabled: true,
            connectionConfig: { baseUrl: 'https://example.com/v1', model: 'gpt-4.1-mini' },
            credentialRef: secondaryCredential.id
          })
        })
      )
      expect(secondaryTargetRes.status).toBe(200)

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-switch/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Switch provider please',
            providerTargetId: 'provider-target-chat-secondary',
            modelId: 'gpt-4.1-mini'
          })
        })
      )
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat-switch', 'complete')
      expect(rows.find((row) => row.role === 'assistant')?.content).toBe('Switched provider')

      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, 'session-chat-switch'))
          .get()
      ).toBeUndefined()

      const sessionRes = await app.handle(
        new Request('http://localhost/sessions/session-chat-switch')
      )
      expect(sessionRes.status).toBe(200)
      expect(await sessionRes.json()).toEqual(
        expect.objectContaining({
          providerTargetId: 'provider-target-chat-primary',
          modelId: null
        })
      )

      const queueRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-switch/queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'Queued on secondary profile',
            providerTargetId: 'provider-target-chat-secondary',
            modelId: 'gpt-4.1-mini'
          })
        })
      )
      expect(queueRes.status).toBe(200)
      const queued = (await queueRes.json()) as ChatQueueItemView
      expect(queued.providerTargetId).toBe('provider-target-chat-secondary')
      expect(fetchSpy).toHaveBeenCalled()
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      fetchSpy.mockRestore()
    }
  })

  it('uses session model preference for the first durable runtime run', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        expect(payload.model).toBe('gpt-session-preferred')
        expect(payload.messages.at(-1)).toEqual({
          role: 'user',
          content: 'Use the preferred model'
        })
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-session-preferred","choices":[{"index":0,"delta":{"content":"Preferred model used"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-session-preferred","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":6,"completion_tokens":3,"total_tokens":9}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-session-model',
          name: 'Workspace Chat Session Model',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-session-model', {
        providerTargetId: 'provider-target-chat-session-model',
        sessionId: 'session-chat-session-model',
        providerKind: 'openai-compatible',
        runtimeKind: 'standard'
      })

      const patchRes = await app.handle(
        new Request('http://localhost/sessions/session-chat-session-model', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modelId: 'gpt-session-preferred' })
        })
      )
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual(
        expect.objectContaining({
          modelId: 'gpt-session-preferred'
        })
      )
      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, 'session-chat-session-model'))
          .get()
      ).toBeUndefined()

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-session-model/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Use the preferred model' })
        })
      )
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat-session-model', 'complete')
      expect(rows.find((row) => row.role === 'assistant')?.content).toBe('Preferred model used')

      expect(
        db()
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.chatSessionId, 'session-chat-session-model'))
          .get()
      ).toBeUndefined()
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      fetchSpy.mockRestore()
    }
  })

  it('does not inject Chronicle per-turn memory into chat runtime system context', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    const chatCompletionPayloads: Array<{
      messages: Array<{ role: string; content: string }>
    }> = []

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        const payload = parseChatCompletionRequestBody(init?.body)
        chatCompletionPayloads.push(payload)
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Use Stripe Checkout."},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":21,"completion_tokens":4,"total_tokens":25}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-memory',
          name: 'Workspace Chat Memory',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .onConflictDoUpdate({
          target: workspaces.id,
          set: {
            name: 'Workspace Chat Memory',
            path: workspaceRoot,
            locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
          }
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-memory', {
        providerTargetId: 'provider-target-chat-memory',
        sessionId: 'session-chat-memory'
      })

      const memoryRes = await app.handle(
        new Request('http://localhost/chronicle/memories', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sourceId: 'chat-memory-project-nebula',
            windowType: '10min',
            createdAt: '2026-05-21T10:04:00Z',
            content:
              'Project Nebula checkout decision: Remember that Project Nebula uses Stripe Checkout and contact alice@example.com only through approved support channels.',
            summaryKind: 'imported',
            sourceSnapshotPaths: [],
            sourceFramePaths: [],
            metadata: { source: 'test' }
          })
        })
      )
      expect(memoryRes.status).toBe(200)

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-memory/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'What should I remember about Project Nebula checkout?',
            modelId: 'gpt-4o-mini'
          })
        })
      )
      expect(runRes.status).toBe(200)

      const rows = await waitForMessageStatus(app, 'session-chat-memory', 'complete')
      expect(rows.find((row) => row.role === 'assistant')?.content).toBe('Use Stripe Checkout.')
      const turnPayload = chatCompletionPayloads.find(
        (payload) =>
          payload.messages.at(-1)?.content ===
          'What should I remember about Project Nebula checkout?'
      )
      expect(turnPayload).toBeTruthy()
      const systemMessage = turnPayload?.messages.find((message) => message.role === 'system')
      expect(systemMessage?.content).toContain('Cradle System Workflow')
      expect(systemMessage?.content).not.toContain('Chronicle long-term memory context follows')
      expect(systemMessage?.content).not.toContain('Project Nebula checkout decision')
      expect(systemMessage?.content).not.toContain(
        'Remember that Project Nebula uses Stripe Checkout'
      )
      expect(systemMessage?.content).not.toContain('alice@example.com')
      expect(
        fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions')).length
      ).toBeGreaterThanOrEqual(1)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      fetchSpy.mockRestore()
    }
  })

  it('streams AI SDK UIMessageChunk frames and ends with finish plus done marker', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST')
        return buildSseResponse([
          'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"stream protocol"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":4,"total_tokens":12}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-stream',
          name: 'Workspace Chat Stream',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-stream', {
        providerTargetId: 'provider-target-chat-stream',
        sessionId: 'session-chat-stream'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-stream/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Stream protocol please', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)

      const chunks = await collectSseChunks(runRes)
      const chunkTypes = chunks.map((chunk) => chunk.type)

      expect(chunkTypes).toEqual(
        expect.arrayContaining([
          'start',
          'start-step',
          'text-start',
          'text-delta',
          'text-end',
          'finish-step',
          'finish'
        ])
      )
      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'start' }))
      expect(chunks.at(-1)).toEqual(
        expect.objectContaining({ type: 'finish', finishReason: 'stop' })
      )
      expect(
        chunks
          .filter(
            (chunk): chunk is UIMessageChunk & { type: 'text-delta'; delta: string } =>
              chunk.type === 'text-delta'
          )
          .map((chunk) => chunk.delta)
          .join('')
      ).toBe('Hello stream protocol')
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('passes malformed runtime chunks through without synthesizing protocol anchors', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexProtocolChunkRuntime([
      { type: 'text-delta', id: 'text-missing-start', delta: 'Recovered text' },
      { type: 'text-end', id: 'text-missing-start' },
      { type: 'tool-output-available', toolCallId: 'call_missing_tool', output: { ok: true } },
      { type: 'finish', finishReason: 'stop' }
    ])
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-protocol-normalization',
          name: 'Workspace Chat Protocol Normalization',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-protocol-normalization', {
        providerTargetId: 'provider-target-chat-protocol-normalization',
        sessionId: 'session-chat-protocol-normalization',
        runtimeKind: 'codex'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-protocol-normalization/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Stream malformed chunks' })
        })
      )
      expect(runRes.status).toBe(200)

      const chunks = await collectSseChunks(runRes)
      expect(chunks).toEqual([
        expect.objectContaining({ type: 'start' }),
        expect.objectContaining({
          type: 'text-delta',
          id: 'text-missing-start',
          delta: 'Recovered text'
        }),
        expect.objectContaining({ type: 'text-end', id: 'text-missing-start' }),
        expect.objectContaining({
          type: 'tool-output-available',
          toolCallId: 'call_missing_tool',
          output: { ok: true }
        }),
        expect.objectContaining({ type: 'finish', finishReason: 'stop' })
      ])
      expect(chunks).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text-start', id: 'text-missing-start' }),
          expect.objectContaining({ type: 'tool-input-start', toolCallId: 'call_missing_tool' })
        ])
      )
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('routes provider-thread synthetic turns without persisting child output into the parent session', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestProviderSyntheticTurnRuntime(25)
    const originalClaudeRuntime = getRuntimeRegistry().get('claude-agent')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-provider-synthetic-turn',
          name: 'Workspace Chat Provider Synthetic Turn',
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot }),
          path: workspaceRoot
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-provider-synthetic-turn', {
        providerTargetId: 'provider-target-chat-provider-synthetic-turn',
        sessionId: 'session-chat-provider-synthetic-turn',
        providerKind: 'anthropic',
        runtimeKind: 'claude-agent'
      })

      const threadStreamRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-chat-provider-synthetic-turn/provider-threads/toolu_background_agent/stream'
        )
      )
      expect(threadStreamRes.status).toBe(200)
      const threadChunksPromise = collectSseChunks(threadStreamRes)

      const runRes = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-chat-provider-synthetic-turn/response',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: 'Launch background agent' })
          }
        )
      )
      expect(runRes.status).toBe(200)
      await collectSseChunks(runRes)
      await runtime.syntheticSettled

      const threadChunks = await threadChunksPromise
      expect(threadChunks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'start' }),
          expect.objectContaining({ type: 'text-delta', delta: 'Background agent report' }),
          expect.objectContaining({ type: 'finish', finishReason: 'stop' })
        ])
      )

      const messageRows = await getChatMessages(app, 'session-chat-provider-synthetic-turn')
      expect(
        messageRows.map((row) => ({ role: row.role, status: row.status, content: row.content }))
      ).toEqual([
        { role: 'user', status: 'complete', content: 'Launch background agent' },
        { role: 'assistant', status: 'complete', content: 'Parent response' }
      ])

      const runRows = db()
        .select()
        .from(backendRuns)
        .where(eq(backendRuns.chatSessionId, 'session-chat-provider-synthetic-turn'))
        .all()
      expect(runRows.map((row) => ({ origin: row.origin, status: row.status }))).toEqual([
        { origin: 'user', status: 'complete' }
      ])
      const eventRows = db()
        .select({
          eventType: sessionEvents.eventType,
          subjectRunId: sessionEvents.subjectRunId
        })
        .from(sessionEvents)
        .where(eq(sessionEvents.aggregateId, 'session-chat-provider-synthetic-turn'))
        .orderBy(sessionEvents.version)
        .all()
      expect(eventRows.map((row) => row.eventType)).toEqual([
        'UserMessageAppended',
        'RunStarted',
        'AssistantMessageCompleted',
        'RunCompleted'
      ])
      expect(getActiveSessionRun('session-chat-provider-synthetic-turn')).toBeNull()
    } finally {
      if (originalClaudeRuntime) {
        registerRuntime(originalClaudeRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('replays buffered AI SDK chunks when joining an active session stream', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        return buildSseResponse(
          [
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
            'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"joined stream"},"finish_reason":null}]}\n\n',
            'data: {"id":"chunk-3","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n'
          ],
          [0, 80, 0, 0]
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-replay',
          name: 'Workspace Chat Replay',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-replay', {
        providerTargetId: 'provider-target-chat-replay',
        sessionId: 'session-chat-replay'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-replay/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Replay active stream', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)
      const runChunksPromise = collectSseChunks(runRes)

      await waitForCondition(async () => {
        const rows = await getChatMessages(app!, 'session-chat-replay')
        expect(rows.find((row) => row.role === 'assistant')?.status).toBe('streaming')
      }, 'active assistant stream row')

      const joinRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-replay/stream')
      )
      expect(joinRes.status).toBe(200)

      const chunks = await collectSseChunks(joinRes)
      const textDeltas = chunks
        .filter(
          (chunk): chunk is UIMessageChunk & { type: 'text-delta'; delta: string } =>
            chunk.type === 'text-delta'
        )
        .map((chunk) => chunk.delta)

      expect(chunks[0]).toEqual(expect.objectContaining({ type: 'start' }))
      expect(textDeltas.join('')).toBe('Hello joined stream')
      expect(chunks.at(-1)).toEqual(expect.objectContaining({ type: 'finish' }))

      await runChunksPromise
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      vi.restoreAllMocks()
    }
  })

  it('persists active streaming snapshots in message rows', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    runtime.blockStreams = true
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let runResponsePromise: Promise<Response> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-active-snapshot',
          name: 'Workspace Chat Active Snapshot',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-active-snapshot', {
        providerTargetId: 'provider-target-chat-active-snapshot',
        sessionId: 'session-chat-active-snapshot',
        runtimeKind: 'codex'
      })

      runResponsePromise = app.handle(
        new Request('http://localhost/chat/sessions/session-chat-active-snapshot/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Keep the stream open.', modelId: 'gpt-4o-mini' })
        })
      )

      await vi.waitFor(() => {
        expect(runtime.streamInputs).toHaveLength(1)
      })
      const run = await waitForBackendRunStatus('session-chat-active-snapshot', 'streaming')

      await waitForCondition(() => {
        const summary = getActiveRunReplayBufferSummary(run.id)
        expect(summary?.textDeltaCount).toBe(1)
        return summary
      }, 'active snapshot replay text delta')

      await flushAllActiveRunSnapshots()

      const assistantRow = db().select().from(messages).where(eq(messages.id, run.messageId!)).get()
      expect(assistantRow).toEqual(
        expect.objectContaining({
          status: 'streaming',
          content: 'Side response'
        })
      )

      db()
        .update(backendRuns)
        .set({
          status: 'failed',
          stopReason: 'response.interrupted',
          errorText: 'persisted terminal failure',
          finishedAt: 1700000100
        })
        .where(eq(backendRuns.id, run.id))
        .run()
      db()
        .update(messages)
        .set({
          status: 'failed',
          content: 'terminal response',
          errorText: 'persisted terminal failure',
          updatedAt: 1700000100
        })
        .where(eq(messages.id, run.messageId!))
        .run()

      await flushAllActiveRunSnapshots()

      expect(db().select().from(messages).where(eq(messages.id, run.messageId!)).get()).toEqual(
        expect.objectContaining({
          status: 'failed',
          content: 'terminal response',
          errorText: 'persisted terminal failure'
        })
      )
    } finally {
      runtime.releaseBlockedStreams()
      if (runResponsePromise) {
        const runResponse = await runResponsePromise.catch(() => null)
        if (runResponse) {
          await collectSseChunks(runResponse).catch(() => undefined)
        }
      }
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('supports abort and returns structured input errors', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        return buildSseResponse(
          [
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Starting "},"finish_reason":null}]}\n\n',
            'data: {"id":"chunk-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"long reply"},"finish_reason":null}]}\n\n',
            'data: [DONE]\n\n'
          ],
          [0, 60, 60]
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat',
          name: 'Workspace Chat',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat', {
        providerTargetId: 'provider-target-chat-abort',
        sessionId: 'session-chat-abort'
      })

      const missingText = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-abort/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        })
      )
      expect(missingText.status).toBe(400)
      expect((await missingText.json()).code).toBe('chat_message_empty')

      const missingSession = await app.handle(
        new Request('http://localhost/chat/sessions/missing/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'hello' })
        })
      )
      expect(missingSession.status).toBe(404)
      expect((await missingSession.json()).code).toBe('chat_session_not_found')

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-abort/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Abort this run', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)

      const abortRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-abort/cancel', {
          method: 'POST'
        })
      )
      expect(abortRes.status).toBe(200)
      expect(await abortRes.json()).toEqual({ ok: true })

      const rows = await getChatMessages(app, 'session-chat-abort')
      const assistantRow = rows.find((row) => row.role === 'assistant')
      expect(assistantRow).toEqual(
        expect.objectContaining({ role: 'assistant', status: 'aborted' })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('keeps message reads projection-only and repairs persisted run state through explicit recovery', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-orphan',
          name: 'Workspace Chat Orphan',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()
      db()
        .insert(providerTargets)
        .values({
          id: 'provider-target-chat-orphan',
          kind: 'manual',
          providerKind: 'openai-compatible',
          displayName: 'Chat Runtime Provider',
          enabled: true,
          iconSlug: null,
          connectionConfigJson: JSON.stringify({ baseUrl: 'https://example.com/v1' }),
          credentialRef: null,
          enabledModelsJson: JSON.stringify(['gpt-4o-mini']),
          customModelsJson: JSON.stringify([]),
          sourceKey: null,
          externalRecordId: null,
          sourceFingerprint: null,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()

      db()
        .insert(sessions)
        .values({
          id: 'session-chat-orphan',
          workspaceId: 'workspace-chat-orphan',
          title: 'Chat Runtime Session',
          providerTargetId: 'provider-target-chat-orphan',
          runtimeKind: 'standard',
          agentId: null,
          configJson: '{}',
          linkedIssueId: null,
          pinned: 0,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()

      db()
        .insert(messages)
        .values({
          id: 'message-orphan-assistant',
          sessionId: 'session-chat-orphan',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: 'partial response',
          messageJson: JSON.stringify({
            id: 'message-orphan-assistant',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial response' }]
          }),
          errorText: null,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()
      db()
        .insert(backendRuns)
        .values({
          id: 'run-chat-orphan',
          bindingId: null,
          chatSessionId: 'session-chat-orphan',
          messageId: 'message-orphan-assistant',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 1700000000,
          finishedAt: null
        })
        .run()
      db()
        .insert(chatSessionQueueItems)
        .values({
          id: 'queue-chat-orphan',
          sessionId: 'session-chat-orphan',
          mode: 'queue',
          status: 'running',
          text: 'orphan queued follow-up',
          filesJson: '[]',
          modelId: 'gpt-4o-mini',
          thinkingEffort: null,
          position: 1,
          sourceRunId: null,
          startedRunId: 'run-chat-orphan',
          errorText: null,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()
      db()
        .insert(messages)
        .values({
          id: 'message-terminal-projection-assistant',
          sessionId: 'session-chat-orphan',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: 'terminal projection drift',
          messageJson: JSON.stringify({
            id: 'message-terminal-projection-assistant',
            role: 'assistant',
            parts: [{ type: 'text', text: 'terminal projection drift' }]
          }),
          errorText: null,
          createdAt: 1700000001,
          updatedAt: 1700000001
        })
        .run()
      db()
        .insert(backendRuns)
        .values({
          id: 'run-terminal-projection',
          bindingId: null,
          chatSessionId: 'session-chat-orphan',
          messageId: 'message-terminal-projection-assistant',
          origin: 'user',
          status: 'aborted',
          stopReason: 'response.cancelled',
          errorText: null,
          startedAt: 1700000001,
          finishedAt: 1700000100
        })
        .run()
      db()
        .insert(chatSessionQueueItems)
        .values({
          id: 'queue-terminal-projection',
          sessionId: 'session-chat-orphan',
          mode: 'queue',
          status: 'running',
          text: 'terminal projection queued follow-up',
          filesJson: '[]',
          modelId: 'gpt-4o-mini',
          thinkingEffort: null,
          position: 2,
          sourceRunId: null,
          startedRunId: 'run-terminal-projection',
          errorText: null,
          createdAt: 1700000001,
          updatedAt: 1700000001
        })
        .run()
      db()
        .insert(backendRunSnapshots)
        .values({
          id: 'snapshot-terminal-projection',
          schemaVersion: 1,
          traceId: 'run-terminal-projection',
          chatSessionId: 'session-chat-orphan',
          runId: 'run-terminal-projection',
          messageId: 'message-terminal-projection-assistant',
          providerTargetId: 'provider-target-chat-orphan',
          runtimeKind: 'standard',
          providerSessionId: null,
          modelId: 'gpt-4o-mini',
          agentId: null,
          workspaceId: 'workspace-chat-orphan',
          status: 'running',
          startedAt: 1700000001000,
          completedAt: null,
          completionReason: null,
          errorText: null,
          summaryJson: '{}'
        })
        .run()

      expect(
        db()
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, 'session-chat-orphan'))
          .all()
      ).toHaveLength(0)

      const rowsBeforeRecovery = await getChatMessages(app, 'session-chat-orphan')
      expect(rowsBeforeRecovery).toEqual([
        expect.objectContaining({
          messageId: 'message-orphan-assistant',
          role: 'assistant',
          status: 'streaming'
        }),
        expect.objectContaining({
          messageId: 'message-terminal-projection-assistant',
          role: 'assistant',
          status: 'streaming'
        })
      ])
      expect(
        db()
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, 'session-chat-orphan'))
          .all()
      ).toHaveLength(0)

      await expect(recoverPersistedRunProjections()).resolves.toEqual({
        interruptedRunsFinalized: 1,
        terminalFactsProjected: 1,
        terminalProjectionDriftsRepaired: 0
      })

      const rows = await getChatMessages(app, 'session-chat-orphan')
      expect(rows).toEqual([
        expect.objectContaining({
          messageId: 'message-orphan-assistant',
          role: 'assistant',
          status: 'failed'
        }),
        expect.objectContaining({
          messageId: 'message-terminal-projection-assistant',
          role: 'assistant',
          status: 'aborted'
        })
      ])

      const run = db().select().from(backendRuns).where(eq(backendRuns.id, 'run-chat-orphan')).get()
      expect(run).toEqual(
        expect.objectContaining({
          status: 'failed',
          stopReason: 'response.interrupted',
          errorText:
            'Response interrupted because the Cradle server process exited while the run was streaming.'
        })
      )
      expect(run?.finishedAt).toEqual(expect.any(Number))

      const queueItem = db()
        .select()
        .from(chatSessionQueueItems)
        .where(eq(chatSessionQueueItems.id, 'queue-chat-orphan'))
        .get()
      expect(queueItem).toEqual(
        expect.objectContaining({
          status: 'failed',
          errorText:
            'Response interrupted because the Cradle server process exited while the run was streaming.',
          startedRunId: 'run-chat-orphan'
        })
      )

      const terminalProjectionQueueItem = db()
        .select()
        .from(chatSessionQueueItems)
        .where(eq(chatSessionQueueItems.id, 'queue-terminal-projection'))
        .get()
      expect(terminalProjectionQueueItem).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          errorText: null,
          startedRunId: 'run-terminal-projection'
        })
      )
      const terminalProjectionSnapshot = db()
        .select()
        .from(backendRunSnapshots)
        .where(eq(backendRunSnapshots.id, 'snapshot-terminal-projection'))
        .get()
      expect(terminalProjectionSnapshot).toEqual(
        expect.objectContaining({
          status: 'aborted',
          completedAt: 1700000100000,
          completionReason: 'response.cancelled',
          errorText: null
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('releases stale active runs when the persisted run is already terminal', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexSideRuntime()
    runtime.blockStreams = true
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined
    let firstResponsePromise: Promise<Response> | null = null

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-stale-active-run',
          name: 'Workspace Stale Active Run',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-stale-active-run', {
        providerTargetId: 'provider-target-stale-active-run',
        sessionId: 'session-stale-active-run',
        runtimeKind: 'codex'
      })

      firstResponsePromise = app.handle(
        new Request('http://localhost/chat/sessions/session-stale-active-run/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start a blocked turn.' })
        })
      )

      await vi.waitFor(() => {
        expect(runtime.streamInputs).toHaveLength(1)
      })

      const run = await waitForBackendRunStatus('session-stale-active-run', 'streaming')
      expect(
        (await getChatMessages(app, 'session-stale-active-run')).find(
          (row) => row.role === 'assistant'
        )
      ).toEqual(expect.objectContaining({ status: 'streaming' }))

      db()
        .update(backendRuns)
        .set({
          status: 'failed',
          stopReason: 'response.interrupted',
          errorText: 'persisted terminal failure',
          finishedAt: 1700000100
        })
        .where(eq(backendRuns.id, run.id))
        .run()

      const eventCountBeforeStatus = db()
        .select({ count: sql<number>`count(*)` })
        .from(sessionEvents)
        .where(eq(sessionEvents.aggregateId, 'session-stale-active-run'))
        .get()!.count
      const statusResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-stale-active-run/runtime-status')
      )
      expect(statusResponse.status).toBe(200)
      const runtimeStatus = (await statusResponse.json()) as {
        status: string
        activeRun: unknown
        latestRun: { status: string } | null
      }
      expect(runtimeStatus).toEqual(
        expect.objectContaining({
          status: 'idle',
          activeRun: null,
          latestRun: expect.objectContaining({ status: 'failed' })
        })
      )
      expect(
        db()
          .select({ count: sql<number>`count(*)` })
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, 'session-stale-active-run'))
          .get()!.count
      ).toBe(eventCountBeforeStatus)

      expect(
        (await getChatMessages(app, 'session-stale-active-run')).find(
          (row) => row.role === 'assistant'
        )
      ).toEqual(expect.objectContaining({ status: 'streaming' }))

      await expect(recoverPersistedRunProjections()).resolves.toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 1,
        terminalProjectionDriftsRepaired: 0
      })

      expect(
        (await getChatMessages(app, 'session-stale-active-run')).find(
          (row) => row.role === 'assistant'
        )
      ).toEqual(
        expect.objectContaining({ status: 'failed', errorText: 'persisted terminal failure' })
      )

      runtime.releaseBlockedStreams()
      await firstResponsePromise

      runtime.blockStreams = false
      const nextResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-stale-active-run/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start a fresh turn.' })
        })
      )
      expect(nextResponse.status).toBe(200)
      await waitForCondition(() => {
        const runs = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-stale-active-run'))
          .all()
        expect(runs.some((row) => row.status === 'complete')).toBe(true)
        return runs
      }, 'fresh turn completion after stale active run release')
    } finally {
      runtime.releaseBlockedStreams()
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('cancels a claimed queue item before a run is started through session events', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      db()
        .insert(sessions)
        .values({
          id: 'session-claimed-queue-cancel',
          title: 'Claimed queue cancellation',
          titleSource: 'initial',
          runtimeKind: 'standard'
        })
        .run()
      commitSessionEventsInTransaction('session-claimed-queue-cancel', [
        queueItemEnqueuedEvent({
          id: 'queue-claimed-cancel',
          sessionId: 'session-claimed-queue-cancel',
          text: 'cancel before run starts',
          position: 1,
          createdAt: 100
        })
      ])

      const claimed = await claimSessionQueueItem(
        'session-claimed-queue-cancel',
        'queue-claimed-cancel'
      )
      expect(claimed).toEqual(
        expect.objectContaining({
          id: 'queue-claimed-cancel',
          status: 'running',
          startedRunId: null
        })
      )

      const cancelled = await cancelQueuedSessionItem(
        'session-claimed-queue-cancel',
        'queue-claimed-cancel'
      )
      expect(cancelled).toEqual(
        expect.objectContaining({
          id: 'queue-claimed-cancel',
          status: 'cancelled',
          startedRunId: null
        })
      )

      const row = db()
        .select()
        .from(chatSessionQueueItems)
        .where(eq(chatSessionQueueItems.id, 'queue-claimed-cancel'))
        .get()
      expect(row).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          startedRunId: null,
          errorText: null
        })
      )

      const events = db()
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.aggregateId, 'session-claimed-queue-cancel'))
        .orderBy(sessionEvents.version)
        .all()
      expect(events.map((event) => event.eventType)).toEqual([
        'QueueItemEnqueued',
        'QueueItemClaimed',
        'QueueItemCancelled'
      ])
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('updates a pending queue item in place and rejects non-pending items', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-queue-update',
          name: 'Workspace Queue Update',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()
      await createProfileAndSession(app, 'workspace-queue-update', {
        providerTargetId: 'provider-target-queue-update',
        sessionId: 'session-queue-update'
      })

      commitSessionEventsInTransaction('session-queue-update', [
        queueItemEnqueuedEvent({
          id: 'queue-update-pending',
          sessionId: 'session-queue-update',
          text: 'original text',
          position: 1,
          createdAt: 100
        }),
        queueItemEnqueuedEvent({
          id: 'queue-update-claimed',
          sessionId: 'session-queue-update',
          text: 'claimed item',
          position: 2,
          createdAt: 110
        }),
        {
          type: 'QueueItemClaimed',
          payload: {
            queueItemId: 'queue-update-claimed',
            sessionId: 'session-queue-update',
            updatedAt: 110
          }
        }
      ])

      const updated = await updateSessionQueueItem({
        sessionId: 'session-queue-update',
        queueItemId: 'queue-update-pending',
        text: 'edited text',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'plan' }
      })
      expect(updated).toEqual(
        expect.objectContaining({
          id: 'queue-update-pending',
          status: 'pending',
          text: 'edited text',
          position: 1,
          runtimeSettings: expect.objectContaining({
            accessMode: 'full-access',
            interactionMode: 'plan'
          })
        })
      )

      const row = db()
        .select()
        .from(chatSessionQueueItems)
        .where(eq(chatSessionQueueItems.id, 'queue-update-pending'))
        .get()
      expect(row).toEqual(
        expect.objectContaining({
          text: 'edited text',
          status: 'pending',
          position: 1,
          runtimeAccessMode: 'full-access',
          runtimeInteractionMode: 'plan'
        })
      )

      const events = db()
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.aggregateId, 'session-queue-update'))
        .all()
      expect(events.map((event) => event.eventType)).toEqual([
        'QueueItemEnqueued',
        'QueueItemEnqueued',
        'QueueItemClaimed',
        'QueueItemUpdated'
      ])

      // Editing a non-pending (claimed) item is rejected.
      await expect(
        updateSessionQueueItem({
          sessionId: 'session-queue-update',
          queueItemId: 'queue-update-claimed',
          text: 'try edit claimed'
        })
      ).rejects.toEqual(expect.objectContaining({ code: 'chat_queue_item_not_pending' }))

      // Editing an unknown item is rejected.
      await expect(
        updateSessionQueueItem({
          sessionId: 'session-queue-update',
          queueItemId: 'queue-missing',
          text: 'nope'
        })
      ).rejects.toEqual(expect.objectContaining({ code: 'chat_queue_item_not_found' }))

      // An empty update is rejected.
      await expect(
        updateSessionQueueItem({
          sessionId: 'session-queue-update',
          queueItemId: 'queue-update-pending'
        })
      ).rejects.toEqual(expect.objectContaining({ code: 'chat_queue_item_empty' }))
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_CREDENTIAL_SECRET', previousSecret)
    }
  })

  it('queues chat session continuations, supports reorder and cancel, and drains after the active run', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const encoder = new TextEncoder()
    const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const completionBodies: string[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const payload = parseChatCompletionRequestBody(init?.body)
        completionBodies.push(payload.messages.at(-1)?.content ?? '')
        const callIndex = completionBodies.length - 1
        return new Response(
          new ReadableStream({
            start(controller) {
              streamControllers[callIndex] = controller
              controller.enqueue(
                encoder.encode(
                  `data: {"id":"queue-${callIndex}-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"run ${callIndex + 1}"},"finish_reason":null}]}\n\n`
                )
              )
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          }
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-queue',
          name: 'Workspace Chat Queue',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-queue', {
        providerTargetId: 'provider-target-chat-queue',
        sessionId: 'session-chat-queue'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-queue/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start long task', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)
      await waitForCondition(
        () => expect(completionBodies).toEqual(['Start long task']),
        'initial chat run to start'
      )

      const queueARes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-queue/queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Queued follow-up A', modelId: 'gpt-4o-mini' })
        })
      )
      expect(queueARes.status).toBe(200)
      const queueA = (await queueARes.json()) as ChatQueueItemView
      expect(queueA).toEqual(
        expect.objectContaining({ mode: 'queue', status: 'pending', text: 'Queued follow-up A' })
      )

      const queueBRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-queue/queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Queued follow-up B', modelId: 'gpt-4o-mini' })
        })
      )
      expect(queueBRes.status).toBe(200)
      const queueB = (await queueBRes.json()) as ChatQueueItemView

      const steerRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-queue/steer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Steer next run', modelId: 'gpt-4o-mini' })
        })
      )
      expect(steerRes.status).toBe(200)
      const steerResult = (await steerRes.json()) as { mode: string, queueItem: ChatQueueItemView }
      expect(steerResult).toEqual(
        expect.objectContaining({
          mode: 'queued',
          ok: true,
          sessionId: 'session-chat-queue'
        })
      )
      expect(steerResult.queueItem).toEqual(
        expect.objectContaining({ mode: 'queue', status: 'pending', text: 'Steer next run' })
      )

      // This test exercises the pre-existing multi-item queue mechanics (reorder/cancel/drain)
      // below, which predate steer's auto-fallback; cancel the auto-queued steer item so those
      // assertions keep exercising exactly the two items they were written against.
      const cancelSteerQueueItemRes = await app.handle(
        new Request(
          `http://localhost/chat/sessions/session-chat-queue/queue/${encodeURIComponent(steerResult.queueItem.id)}`,
          { method: 'DELETE' }
        )
      )
      expect(cancelSteerQueueItemRes.status).toBe(200)

      let visibleQueue = await listChatQueue(app, 'session-chat-queue')
      expect(
        visibleQueue.filter((item) => item.status === 'pending').map((item) => item.id)
      ).toEqual([queueA.id, queueB.id])

      const reorderRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-queue/queue/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ queueItemIds: [queueB.id, queueA.id] })
        })
      )
      expect(reorderRes.status).toBe(200)
      visibleQueue = await listChatQueue(app, 'session-chat-queue')
      expect(
        visibleQueue.filter((item) => item.status === 'pending').map((item) => item.id)
      ).toEqual([queueB.id, queueA.id])

      const cancelRes = await app.handle(
        new Request(
          `http://localhost/chat/sessions/session-chat-queue/queue/${encodeURIComponent(queueA.id)}`,
          {
            method: 'DELETE'
          }
        )
      )
      expect(cancelRes.status).toBe(200)
      expect(await cancelRes.json()).toEqual(
        expect.objectContaining({ id: queueA.id, status: 'cancelled' })
      )

      streamControllers[0].enqueue(
        encoder.encode(
          'data: {"id":"queue-0-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n'
        )
      )
      streamControllers[0].enqueue(encoder.encode('data: [DONE]\n\n'))
      streamControllers[0].close()

      await waitForCondition(
        () => expect(completionBodies).toEqual(['Start long task', 'Queued follow-up B']),
        'queued item to drain without rejected steer'
      )
      streamControllers[1].enqueue(
        encoder.encode(
          'data: {"id":"queue-1-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n'
        )
      )
      streamControllers[1].enqueue(encoder.encode('data: [DONE]\n\n'))
      streamControllers[1].close()

      await waitForCondition(async () => {
        const items = await listChatQueue(app!, 'session-chat-queue')
        expect(items.find((item) => item.id === queueB.id)).toEqual(
          expect.objectContaining({ status: 'completed' })
        )
        expect(items.find((item) => item.id === queueA.id)).toEqual(
          expect.objectContaining({ status: 'cancelled' })
        )
      }, 'queue items to reach terminal states')

      const rows = await getChatMessages(app, 'session-chat-queue')
      expect(rows.filter((row) => row.role === 'user').map((row) => row.content)).toEqual(
        expect.arrayContaining(['Start long task', 'Queued follow-up B'])
      )
      expect(rows.filter((row) => row.role === 'user').map((row) => row.content)).not.toContain(
        'Steer next run'
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('fails fast when a stored message snapshot is invalid instead of rebuilding from content', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-invalid-snapshot',
          name: 'Workspace Chat Invalid Snapshot',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-invalid-snapshot', {
        providerTargetId: 'provider-target-chat-invalid-snapshot',
        sessionId: 'session-chat-invalid-snapshot'
      })

      db()
        .insert(messages)
        .values({
          id: 'message-invalid-snapshot',
          sessionId: 'session-chat-invalid-snapshot',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'complete',
          content: 'fallback text must never hydrate UIMessage',
          messageJson: '{}',
          errorText: null,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-invalid-snapshot/messages')
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual(
        expect.objectContaining({
          code: 'chat_message_snapshot_invalid',
          message: 'Stored chat message snapshot is invalid',
          details: expect.objectContaining({
            messageId: 'message-invalid-snapshot',
            reason: expect.any(String)
          })
        })
      )
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('preserves UIMessage metadata when hydrating stored message snapshots', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-message-metadata',
          name: 'Workspace Chat Message Metadata',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()
      db()
        .insert(sessions)
        .values({
          id: 'session-chat-message-metadata',
          workspaceId: 'workspace-chat-message-metadata',
          title: 'Chat Message Metadata',
          providerTargetId: null,
          runtimeKind: 'codex',
          agentId: null,
          configJson: '{}',
          linkedIssueId: null
        })
        .run()

      db()
        .insert(messages)
        .values({
          id: 'message-bang-command-metadata',
          sessionId: 'session-chat-message-metadata',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: '!echo hello',
          messageJson: JSON.stringify({
            id: 'message-bang-command-metadata',
            role: 'user',
            parts: [{ type: 'text', text: '!echo hello' }],
            metadata: {
              cradle: {
                bangCommand: { command: 'echo hello' }
              }
            }
          } satisfies UIMessage),
          errorText: null,
          createdAt: 1700000000,
          updatedAt: 1700000000
        })
        .run()

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-message-metadata/messages')
      )
      expect(response.status).toBe(200)
      const rows = (await response.json()) as ChatMessageRow[]
      expect(rows).toHaveLength(1)
      expect(rows[0].message.metadata).toEqual({
        cradle: {
          bangCommand: { command: 'echo hello' }
        }
      })
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      vi.restoreAllMocks()
    }
  })

  it('coalesces high-frequency replay deltas for active session stream joins', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const chunks = Array.from(
          { length: 80 },
          (_, index) =>
            `data: {"id":"chunk-${index}","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"${index} "},"finish_reason":null}]}\n\n`
        )
        return buildSseResponse(
          [
            ...chunks,
            'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n'
          ],
          [0, ...Array.from({ length: 80 }).fill(1), 0]
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-coalesced-replay',
          name: 'Workspace Chat Coalesced Replay',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-coalesced-replay', {
        providerTargetId: 'provider-target-chat-coalesced-replay',
        sessionId: 'session-chat-coalesced-replay'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-coalesced-replay/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Replay many deltas', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)
      const runChunksPromise = collectSseChunks(runRes)

      await waitForCondition(async () => {
        const rows = await getChatMessages(app!, 'session-chat-coalesced-replay')
        expect(rows.find((row) => row.role === 'assistant')?.status).toBe('streaming')
      }, 'active assistant stream row')

      const activeRun = await waitForCondition(async () => {
        const run = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-chat-coalesced-replay'))
          .get()
        const summary = run ? getActiveRunReplayBufferSummary(run.id) : null
        expect(summary?.textDeltaCount).toBe(1)
        return summary
      }, 'coalesced replay buffer')

      expect(activeRun?.chunkCount).toBeLessThan(10)
      expect(activeRun?.textDeltaCount).toBe(1)

      const runChunks = await runChunksPromise
      const runTextDeltas = runChunks.filter((chunk) => chunk.type === 'text-delta')
      expect(runTextDeltas.length).toBeLessThan(20)
      const rows = await waitForMessageStatus(app, 'session-chat-coalesced-replay', 'complete')
      const expectedText = Array.from({ length: 80 }, (_, index) => `${index} `).join('')
      expect(
        runTextDeltas
          .map((chunk) => {
            if (chunk.type === 'text-delta') {
              return chunk.delta
            }
            return ''
          })
          .join('')
      ).toBe(expectedText)
      expect(rows.find((row) => row.role === 'assistant')?.content).toBe(expectedText)
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('segments replay delta coalescing before strings grow too large', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousFlushChars = process.env.CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS = '16'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const chunks = Array.from(
          { length: 80 },
          (_, index) =>
            `data: {"id":"chunk-${index}","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"abcd"},"finish_reason":null}]}\n\n`
        )
        return buildSseResponse(
          [
            ...chunks,
            'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n'
          ],
          [0, ...Array.from({ length: 80 }).fill(5), 0]
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-segmented-replay',
          name: 'Workspace Chat Segmented Replay',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-segmented-replay', {
        providerTargetId: 'provider-target-chat-segmented-replay',
        sessionId: 'session-chat-segmented-replay'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-segmented-replay/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Segment replay deltas', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)
      const runChunksPromise = collectSseChunks(runRes)

      await waitForCondition(async () => {
        const rows = await getChatMessages(app!, 'session-chat-segmented-replay')
        expect(rows.find((row) => row.role === 'assistant')?.status).toBe('streaming')
      }, 'active segmented replay row')

      const activeRun = await waitForCondition(async () => {
        const run = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-chat-segmented-replay'))
          .get()
        const summary = run ? getActiveRunReplayBufferSummary(run.id) : null
        expect(summary?.textDeltaCount).toBeGreaterThan(1)
        expect(summary?.maxDeltaChars).toBeLessThanOrEqual(16)
        return summary
      }, 'segmented replay buffer')

      expect(activeRun?.textDeltaCount).toBeLessThanOrEqual(80)
      expect(activeRun?.maxDeltaChars).toBeLessThanOrEqual(16)

      const runChunks = await runChunksPromise
      const textDeltas = runChunks.filter(
        (chunk): chunk is UIMessageChunk & { type: 'text-delta'; delta: string } =>
          chunk.type === 'text-delta'
      )
      expect(textDeltas.every((chunk) => chunk.delta.length <= 16)).toBe(true)
      expect(textDeltas.map((chunk) => chunk.delta).join('')).toBe('abcd'.repeat(80))
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      restoreEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', previousFlushChars)
      vi.restoreAllMocks()
    }
  })

  it('keeps replay buffers bounded across concurrent active session streams', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        const chunks = Array.from(
          { length: 120 },
          (_, index) =>
            `data: {"id":"chunk-${index}","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"${index} "},"finish_reason":null}]}\n\n`
        )
        return buildSseResponse(
          [
            ...chunks,
            'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n'
          ],
          [0, ...Array.from({ length: 120 }).fill(1), 0]
        )
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-concurrent-replay',
          name: 'Workspace Chat Concurrent Replay',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      const sessionIds = [
        'session-chat-concurrent-1',
        'session-chat-concurrent-2',
        'session-chat-concurrent-3'
      ]
      for (const sessionId of sessionIds) {
        await createProfileAndSession(app, 'workspace-chat-concurrent-replay', {
          providerTargetId: `provider-target-${sessionId}`,
          sessionId
        })
      }

      const responses = await Promise.all(
        sessionIds.map((sessionId) =>
          app!.handle(
            new Request(`http://localhost/chat/sessions/${sessionId}/response`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: 'Concurrent replay pressure', modelId: 'gpt-4o-mini' })
            })
          )
        )
      )
      for (const response of responses) {
        expect(response.status).toBe(200)
      }
      const responseChunkPromises = responses.map((response) => collectSseChunks(response))

      await waitForCondition(async () => {
        const runs = db().select().from(backendRuns).all()
        expect(runs.filter((run) => sessionIds.includes(run.chatSessionId)).length).toBe(3)

        for (const run of runs.filter((run) => sessionIds.includes(run.chatSessionId))) {
          const summary = getActiveRunReplayBufferSummary(run.id)
          expect(summary?.textDeltaCount).toBe(1)
          expect(summary?.chunkCount).toBeLessThan(10)
        }
      }, 'bounded concurrent replay buffers')

      const responseChunks = await Promise.all(responseChunkPromises)
      for (const chunks of responseChunks) {
        expect(chunks.filter((chunk) => chunk.type === 'text-delta').length).toBeLessThan(30)
      }
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('compacts oversized assistant snapshots before persistence', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousTextLimit = process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'
    process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '20'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url.endsWith('/chat/completions')) {
        return buildSseResponse([
          'data: {"id":"chunk-text","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"assistant text that should be compacted"},"finish_reason":null}]}\n\n',
          'data: {"id":"chunk-final","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":4,"total_tokens":8}}\n\n',
          'data: [DONE]\n\n'
        ])
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-chat-compact-snapshot',
          name: 'Workspace Chat Compact Snapshot',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-chat-compact-snapshot', {
        providerTargetId: 'provider-target-chat-compact-snapshot',
        sessionId: 'session-chat-compact-snapshot'
      })

      const runRes = await app.handle(
        new Request('http://localhost/chat/sessions/session-chat-compact-snapshot/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Compact final snapshot.', modelId: 'gpt-4o-mini' })
        })
      )
      expect(runRes.status).toBe(200)
      await waitForMessageStatus(app, 'session-chat-compact-snapshot', 'complete')

      const assistantRow = db()
        .select()
        .from(messages)
        .where(eq(messages.sessionId, 'session-chat-compact-snapshot'))
        .all()
        .find((row) => row.role === 'assistant')
      const storedMessage = JSON.parse(assistantRow?.messageJson ?? '{}') as {
        parts: Array<{ type: string; text?: string }>
      }
      expect(storedMessage.parts.find((part) => part.type === 'text')?.text).toHaveLength(20)
      expect(assistantRow?.content).toBe('assistant text that ')
    } finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
      restoreEnv('CRADLE_CHAT_STORED_TEXT_MAX_CHARS', previousTextLimit)
      vi.restoreAllMocks()
    }
  })

  it('routes shell-capable runtime bang commands through the runtime shell command hook', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestShellCommandRuntime()
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime, undefined, 'chat-runtime-test')
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-bang-command',
          name: 'Workspace Codex Bang Command',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-bang-command', {
        providerTargetId: 'provider-target-codex-bang-command',
        sessionId: 'session-codex-bang-command',
        runtimeKind: runtime.runtimeKind
      })

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-bang-command/bang-command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command: ' echo hello ' })
        })
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        command: string
        stdout: string
        stderr: string
        exitCode: number | null
        userMessage: UIMessage
        resultMessage: UIMessage
      }

      expect(runtime.shellInputs).toHaveLength(1)
      expect(runtime.shellInputs[0]).toEqual(
        expect.objectContaining({
          command: 'echo hello',
          workspaceId: 'workspace-codex-bang-command',
          workspacePath: workspaceRoot,
          modelId: 'shell-test-model'
        })
      )
      expect(body).toEqual(
        expect.objectContaining({
          command: 'echo hello',
          stdout: 'hello from shell capable runtime\n',
          stderr: '',
          exitCode: 0
        })
      )
      expect(body.userMessage.metadata).toEqual({
        cradle: {
          bangCommand: { command: 'echo hello' }
        }
      })
      expect(body.resultMessage.metadata).toEqual({
        cradle: {
          bangResult: {
            command: 'echo hello',
            stdout: 'hello from shell capable runtime\n',
            stderr: '',
            exitCode: 0,
            durationMs: 11,
            timedOut: false,
            truncated: false
          }
        }
      })

      const rows = await getChatMessages(app, 'session-codex-bang-command')
      expect(rows.map(row => row.content)).toEqual(['!echo hello', 'hello from shell capable runtime\n'])
    } finally {
      unregisterRuntime(runtime.runtimeKind, 'chat-runtime-test')
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('starts a new system run and assistant message when an active Codex goal fails without user cancellation', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexGoalContinuationRuntime({ failFirstRun: true })
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-goal-auto',
          name: 'Workspace Codex Goal Auto',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-goal-auto', {
        providerTargetId: 'provider-target-codex-goal-auto',
        sessionId: 'session-codex-goal-auto',
        runtimeKind: 'codex'
      })

      const response = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-goal-auto/response', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Start the active goal.' })
        })
      )
      expect(response.status).toBe(200)
      await collectSseChunks(response)

      const continuationRun = await waitForCondition(() => {
        const runs = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-codex-goal-auto'))
          .all()
          .sort((left, right) => left.startedAt - right.startedAt)
        expect(runs).toHaveLength(2)
        expect(runs[0]).toEqual(expect.objectContaining({ origin: 'user', status: 'failed' }))
        expect(runs[1]).toEqual(expect.objectContaining({ origin: 'system', status: 'complete' }))
        return runs[1]
      }, 'Codex goal continuation system run')

      expect(runtime.streamInputs).toHaveLength(2)
      expect(runtime.streamInputs[0]?.message).toEqual(
        expect.objectContaining({
          role: 'user',
          parts: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: 'Start the active goal.' })
          ])
        })
      )
      expect(runtime.streamInputs[1]?.runId).toBe(continuationRun.id)
      expect(runtime.streamInputs[1]?.responseMessageId).toBe(continuationRun.messageId)
      expect(runtime.streamInputs[1]?.message).toEqual(
        expect.objectContaining({
          role: 'user',
          metadata: {
            cradle: {
              codex: { goalContinuation: true }
            }
          }
        })
      )

      const messageRows = db()
        .select()
        .from(messages)
        .where(eq(messages.sessionId, 'session-codex-goal-auto'))
        .all()
      const visibleUserRows = messageRows.filter((row) => row.role === 'user')
      const assistantRows = messageRows.filter((row) => row.role === 'assistant')
      expect(visibleUserRows).toHaveLength(1)
      expect(assistantRows).toHaveLength(2)
      expect(assistantRows.find((row) => row.id === continuationRun.messageId)).toEqual(
        expect.objectContaining({
          status: 'complete',
          content: 'Goal continued'
        })
      )

      const statusResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-goal-auto/runtime-status')
      )
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(
        expect.objectContaining({
          status: 'idle',
          hasActiveGoal: false,
          latestRun: expect.objectContaining({
            runId: continuationRun.id,
            messageId: continuationRun.messageId,
            status: 'complete'
          })
        })
      )
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('wakes an idle failed Codex goal from runtime status polling without a new user message', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexGoalContinuationRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-goal-status-wake',
          name: 'Workspace Codex Goal Status Wake',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-goal-status-wake', {
        providerTargetId: 'provider-target-codex-goal-status-wake',
        sessionId: 'session-codex-goal-status-wake',
        runtimeKind: 'codex'
      })

      const now = 1_700_000_000
      db()
        .insert(messages)
        .values([
          {
            id: 'message-codex-goal-status-user',
            sessionId: 'session-codex-goal-status-wake',
            parentMessageId: null,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'user',
            status: 'complete',
            content: 'Previous failed goal run.',
            messageJson: JSON.stringify({
              id: 'message-codex-goal-status-user',
              role: 'user',
              parts: [{ type: 'text', text: 'Previous failed goal run.' }]
            } satisfies UIMessage),
            errorText: null,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'message-codex-goal-status-assistant-failed',
            sessionId: 'session-codex-goal-status-wake',
            parentMessageId: null,
            parentToolCallId: null,
            taskId: null,
            depth: 0,
            role: 'assistant',
            status: 'failed',
            content: '',
            messageJson: JSON.stringify({
              id: 'message-codex-goal-status-assistant-failed',
              role: 'assistant',
              parts: []
            } satisfies UIMessage),
            errorText: 'exceeded retry limit, last status: 429 Too Many Requests',
            createdAt: now + 1,
            updatedAt: now + 1
          }
        ])
        .run()
      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-goal-status-wake',
          chatSessionId: 'session-codex-goal-status-wake',
          providerTargetId: 'provider-target-codex-goal-status-wake',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-goal-auto',
          backendStateSnapshot: JSON.stringify({
            models: { currentModelId: null },
            codex: {
              goal: {
                threadId: 'codex-thread-goal-auto',
                objective: 'Keep going',
                status: 'active',
                tokenBudget: null,
                tokensUsed: 0,
                timeUsedSeconds: 0,
                createdAt: 1,
                updatedAt: 2
              }
            }
          }),
          requestedModelId: null,
          createdAt: now,
          updatedAt: now
        })
        .run()
      db()
        .insert(backendRuns)
        .values({
          id: 'run-codex-goal-status-failed',
          bindingId: 'binding-codex-goal-status-wake',
          chatSessionId: 'session-codex-goal-status-wake',
          messageId: 'message-codex-goal-status-assistant-failed',
          origin: 'user',
          status: 'failed',
          stopReason: 'response.failed',
          errorText: 'exceeded retry limit, last status: 429 Too Many Requests',
          startedAt: now + 1,
          finishedAt: now + 1
        })
        .run()

      const statusResponse = await app.handle(
        new Request('http://localhost/chat/sessions/session-codex-goal-status-wake/runtime-status')
      )
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(
        expect.objectContaining({
          status: 'idle',
          hasActiveGoal: true
        })
      )

      const continuationRun = await waitForCondition(() => {
        const runs = db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-codex-goal-status-wake'))
          .all()
        expect(runs).toHaveLength(2)
        const run = runs.find((row) => row.origin === 'system')
        expect(run).toEqual(expect.objectContaining({ status: 'complete' }))
        return run!
      }, 'runtime-status awakened Codex goal continuation')

      expect(runtime.streamInputs).toHaveLength(1)
      expect(runtime.streamInputs[0]?.runId).toBe(continuationRun.id)
      expect(runtime.streamInputs[0]?.message).toEqual(
        expect.objectContaining({
          metadata: {
            cradle: {
              codex: { goalContinuation: true }
            }
          }
        })
      )
      expect(
        db()
          .select()
          .from(messages)
          .where(eq(messages.sessionId, 'session-codex-goal-status-wake'))
          .all()
          .filter((row) => row.role === 'user')
      ).toHaveLength(1)
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('does not wake an idle Codex goal when the provider target is disabled', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexGoalContinuationRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-goal-disabled-target',
          name: 'Workspace Codex Goal Disabled Target',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-goal-disabled-target', {
        providerTargetId: 'provider-target-codex-goal-disabled',
        sessionId: 'session-codex-goal-disabled-target',
        runtimeKind: 'codex'
      })

      const now = 1_700_000_000
      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-goal-disabled-target',
          chatSessionId: 'session-codex-goal-disabled-target',
          providerTargetId: 'provider-target-codex-goal-disabled',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-goal-disabled',
          backendStateSnapshot: JSON.stringify({
            models: { currentModelId: null },
            codex: {
              goal: {
                threadId: 'codex-thread-goal-disabled',
                objective: 'Keep going',
                status: 'active',
                tokenBudget: null,
                tokensUsed: 0,
                timeUsedSeconds: 0,
                createdAt: 1,
                updatedAt: 2
              }
            }
          }),
          requestedModelId: null,
          createdAt: now,
          updatedAt: now
        })
        .run()
      db()
        .update(providerTargets)
        .set({ enabled: false, updatedAt: now + 1 })
        .where(eq(providerTargets.id, 'provider-target-codex-goal-disabled'))
        .run()

      const statusResponse = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-goal-disabled-target/runtime-status'
        )
      )
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(
        expect.objectContaining({
          status: 'idle',
          providerTargetId: 'provider-target-codex-goal-disabled',
          hasActiveGoal: false
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(runtime.streamInputs).toHaveLength(0)
      expect(
        db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-codex-goal-disabled-target'))
          .all()
      ).toHaveLength(0)
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('ignores stale Codex goal bindings after the session switches provider target', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chat-runtime-secret'

    const runtime = new TestCodexGoalContinuationRuntime()
    const originalCodexRuntime = getRuntimeRegistry().get('codex')
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      registerRuntime(runtime)
      db()
        .insert(workspaces)
        .values({
          id: 'workspace-codex-goal-stale-binding',
          name: 'Workspace Codex Goal Stale Binding',
          path: workspaceRoot,
          locatorJson: JSON.stringify({ hostId: 'local', path: workspaceRoot })
        })
        .run()

      await createProfileAndSession(app, 'workspace-codex-goal-stale-binding', {
        providerTargetId: 'provider-target-codex-goal-current',
        sessionId: 'session-codex-goal-stale-binding',
        runtimeKind: 'codex'
      })
      db()
        .insert(providerTargets)
        .values({
          id: 'provider-target-codex-goal-stale',
          kind: 'manual',
          providerKind: 'openai-compatible',
          displayName: 'Stale Codex Provider',
          enabled: true,
          iconSlug: null,
          connectionConfigJson: JSON.stringify({ baseUrl: 'https://example.com/v1' }),
          credentialRef: null,
          enabledModelsJson: JSON.stringify(['gpt-4o-mini']),
          customModelsJson: JSON.stringify([]),
          sourceKey: null,
          externalRecordId: null,
          sourceFingerprint: null,
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000
        })
        .run()
      db()
        .insert(backendSessionBindings)
        .values({
          id: 'binding-codex-goal-stale',
          chatSessionId: 'session-codex-goal-stale-binding',
          providerTargetId: 'provider-target-codex-goal-stale',
          runtimeKind: 'codex',
          backendSessionId: 'codex-thread-stale',
          backendStateSnapshot: JSON.stringify({
            models: { currentModelId: null },
            codex: {
              goal: {
                threadId: 'codex-thread-stale',
                objective: 'Keep going on the stale target',
                status: 'active',
                tokenBudget: null,
                tokensUsed: 0,
                timeUsedSeconds: 0,
                createdAt: 1,
                updatedAt: 2
              }
            }
          }),
          requestedModelId: null,
          createdAt: 1_700_000_001,
          updatedAt: 1_700_000_001
        })
        .run()

      const statusResponse = await app.handle(
        new Request(
          'http://localhost/chat/sessions/session-codex-goal-stale-binding/runtime-status'
        )
      )
      expect(statusResponse.status).toBe(200)
      expect(await statusResponse.json()).toEqual(
        expect.objectContaining({
          status: 'idle',
          providerTargetId: 'provider-target-codex-goal-current',
          providerSessionId: null,
          hasActiveGoal: false
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(runtime.streamInputs).toHaveLength(0)
      expect(
        db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.chatSessionId, 'session-codex-goal-stale-binding'))
          .all()
      ).toHaveLength(0)
    } finally {
      if (originalCodexRuntime) {
        registerRuntime(originalCodexRuntime)
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      } else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      } else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })
})
