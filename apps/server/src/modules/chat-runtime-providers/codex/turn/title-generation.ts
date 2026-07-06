import type { RuntimeSession } from '../../../chat-runtime/runtime-provider-types'
import { createBoundedTextCollector } from '../../bounded-text-collector'
import type { CodexAppServerMessage } from '../app-server/client'
import type { UserInput } from '../app-server-protocol/v2/UserInput'
import { toSandboxPolicy } from '../config/sandbox-policy'
import {
  projectCodexGoalSnapshotFromGoal,
  readCodexProviderSnapshot,
  writeCodexGoalSnapshot,
} from '../projection/state-projector'
import { codexRequestError, formatUnknownError } from '../provider-errors'
import type {
  CodexAppServerClientLike,
  CodexGoalSnapshot,
  ItemNotificationParams,
  ThreadGoalGetResponse,
  ThreadResponse,
  TurnResponse,
} from '../types'
import { getNotificationTurnId, getThreadId } from './stream-diagnostics'

const CODEX_THREAD_TITLE_MAX_LENGTH = 36
export type CodexTitleGenerationThinkingEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
const CODEX_THREAD_TITLE_PROMPT_PREFIX = [
  'You are naming a Codex task thread.',
  'Generate a concise UI title for the user prompt below.',
  `Keep it at or below ${CODEX_THREAD_TITLE_MAX_LENGTH} characters when possible.`,
  'Use the same language as the user prompt.',
  'Do not answer the prompt.',
  'Do not include quotes, markdown, labels, or trailing punctuation.',
  '',
  'User prompt:',
].join('\n')

export async function setCodexThreadGoal(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  threadId: string,
  objective: string,
): Promise<CodexGoalSnapshot | null> {
  const response = (await client.request('thread/goal/set', {
    threadId,
    objective,
  })) as ThreadGoalGetResponse
  const goalSnapshot = projectCodexGoalSnapshotFromGoal(response.goal ?? null)
  if (!goalSnapshot) {
    return null
  }
  writeCodexGoalSnapshot(runtimeSession, goalSnapshot)
  return readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.goal ?? null
}

export function shouldGenerateCodexThreadTitle(input: {
  isFreshProviderThread: boolean
  existingTitle: string | null
  promptText: string
  goalContinuationRequested: boolean
  compactCommandRequested: boolean
}): boolean {
  return (
    input.isFreshProviderThread
    && !input.existingTitle
    && input.promptText.length > 0
    && !input.goalContinuationRequested
    && !input.compactCommandRequested
  )
}

export async function generateAndSetCodexThreadTitle(
  titleClient: CodexAppServerClientLike,
  mainClient: CodexAppServerClientLike,
  input: {
    mainThreadId: string
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    config: Record<string, unknown>
    signal: AbortSignal
  },
): Promise<string | null> {
  try {
    return await generateAndSetCodexThreadTitleOrThrow(titleClient, mainClient, input)
  }
 catch {
    return null
  }
}

export async function generateAndSetCodexThreadTitleOrThrow(
  titleClient: CodexAppServerClientLike,
  mainClient: CodexAppServerClientLike,
  input: {
    mainThreadId: string
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    config: Record<string, unknown>
    signal: AbortSignal
  },
): Promise<string> {
  const title = await generateCodexThreadTitle(titleClient, input)
  if (input.signal.aborted) {
    throw codexRequestError('title/generate', 'Codex title generation was aborted')
  }
  if (!title) {
    throw codexRequestError('title/generate', 'Codex title turn completed without title output')
  }
  try {
    await setCodexThreadTitleName(mainClient, titleClient, {
      threadId: input.mainThreadId,
      name: title,
    })
  }
 catch (error) {
    throw codexRequestError('thread/name/set', formatUnknownError(error))
  }
  return title
}

async function setCodexThreadTitleName(
  primaryClient: CodexAppServerClientLike,
  fallbackClient: CodexAppServerClientLike,
  params: {
    threadId: string
    name: string
  },
): Promise<void> {
  try {
    await primaryClient.request('thread/name/set', params)
  }
 catch {
    await fallbackClient.request('thread/name/set', params)
  }
}

async function generateCodexThreadTitle(
  client: CodexAppServerClientLike,
  input: {
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    config: Record<string, unknown>
    signal: AbortSignal
  },
): Promise<string | null> {
  const model = input.modelId ?? input.fallbackModel
  const titleConfig = buildCodexTitleConfig(input.config, model)
  let titleThreadId: string | null = null
  try {
    let threadResponse: ThreadResponse
    try {
      threadResponse = (await client.request('thread/start', {
        model,
        cwd: input.cwd,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config: titleConfig,
        ephemeral: true,
        threadSource: 'user',
      })) as ThreadResponse
    }
 catch (error) {
      throw codexRequestError('thread/start', formatUnknownError(error))
    }
    titleThreadId = threadResponse.thread?.id ?? null
    if (!titleThreadId) {
      throw codexRequestError('thread/start', 'Codex title thread did not return a thread id')
    }

    let turnResponse: TurnResponse
    try {
      turnResponse = (await client.request('turn/start', {
        threadId: titleThreadId,
        input: buildCodexThreadTitleInput(input.promptText),
        cwd: input.cwd,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
        approvalPolicy: 'never',
        sandboxPolicy: toSandboxPolicy('read-only', input.runtimeWorkspaceRoots, []),
        model,
        effort: input.thinkingEffort,
      })) as TurnResponse
    }
 catch (error) {
      throw codexRequestError('turn/start', formatUnknownError(error))
    }
    const turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
    return await readGeneratedCodexThreadTitle(client, titleThreadId, turnId, input.signal)
  }
 finally {
    if (titleThreadId) {
      await client.request('thread/unsubscribe', { threadId: titleThreadId }).catch(() => undefined)
    }
  }
}

export function buildCodexTitleConfig(config: Record<string, unknown>, model: string | null): Record<string, unknown> {
  const titleConfig = { ...config }
  delete titleConfig.instructions_paths
  titleConfig.disable_response_storage = true
  if (model) {
    titleConfig.model = model
  }
  return titleConfig
}

function buildCodexThreadTitleInput(promptText: string): UserInput[] {
  return [
    {
      type: 'text',
      text: `${CODEX_THREAD_TITLE_PROMPT_PREFIX}\n${promptText}`,
      text_elements: [],
    },
  ]
}

async function readGeneratedCodexThreadTitle(
  client: CodexAppServerClientLike,
  threadId: string,
  turnId: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  const titleAbortController = new AbortController()
  const abortTitleRead = () => titleAbortController.abort()
  signal.addEventListener('abort', abortTitleRead, { once: true })
  const deltas = createBoundedTextCollector()
  let completedText: string | null = null
  try {
    if (signal.aborted) {
      return null
    }
    while (!titleAbortController.signal.aborted) {
      let notification: CodexAppServerMessage | null
      try {
        notification = await client.nextNotification(titleAbortController.signal)
      }
 catch (error) {
        if (titleAbortController.signal.aborted) {
          return null
        }
        throw error
      }
      if (!notification) {
        return null
      }
      const notificationThreadId = getThreadId(notification)
      if (notification.method === 'error' && (!notificationThreadId || notificationThreadId === threadId)) {
        throw codexRequestError('title/notification', readCodexAppServerErrorDetail(notification))
      }
      if (notificationThreadId !== threadId) {
        continue
      }
      const notificationTurnId = getNotificationTurnId(notification)
      if (turnId && notificationTurnId && notificationTurnId !== turnId) {
        continue
      }
      if (notification.method === 'item/agentMessage/delta') {
        const delta = (notification.params as { delta?: string } | undefined)?.delta
        if (delta) {
          deltas.append(delta)
        }
        continue
      }
      if (notification.method === 'item/completed') {
        const item = (notification.params as ItemNotificationParams | undefined)?.item
        if (item?.type === 'agentMessage' && item.text) {
          completedText = item.text
        }
        continue
      }
      if (notification.method === 'turn/completed') {
        return normalizeGeneratedCodexThreadTitle(completedText ?? deltas.read())
      }
    }
    return null
  }
 finally {
    signal.removeEventListener('abort', abortTitleRead)
  }
}

function normalizeGeneratedCodexThreadTitle(title: string | null | undefined): string | null {
  const candidate = readGeneratedCodexThreadTitleCandidate(title)
  const normalized = candidate
    ?.replace(/\s+/g, ' ')
    .trim()
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .trim()
  if (!normalized) {
    return null
  }
  if (normalized.length <= CODEX_THREAD_TITLE_MAX_LENGTH) {
    return normalized
  }
  return normalized.slice(0, CODEX_THREAD_TITLE_MAX_LENGTH).trim().replace(/[.!?]+$/g, '') || null
}

function readCodexAppServerErrorDetail(notification: CodexAppServerMessage): string {
  const params = notification.params
  if (!params || typeof params !== 'object') {
    return 'Codex app-server reported an error'
  }
  const candidate = params as {
    message?: unknown
    error?: unknown
    code?: unknown
    details?: unknown
    additionalDetails?: unknown
  }
  const nestedError
    = candidate.error && typeof candidate.error === 'object'
      ? (candidate.error as { message?: unknown, details?: unknown, additionalDetails?: unknown })
      : null
  const message
    = typeof candidate.message === 'string'
      ? candidate.message
      : typeof candidate.error === 'string'
        ? candidate.error
        : typeof nestedError?.message === 'string'
          ? nestedError.message
          : null
  const code
    = typeof candidate.code === 'string' || typeof candidate.code === 'number' ? String(candidate.code) : null
  const details
    = typeof candidate.details === 'string'
      ? candidate.details
      : typeof candidate.additionalDetails === 'string'
        ? candidate.additionalDetails
        : typeof nestedError?.details === 'string'
          ? nestedError.details
          : typeof nestedError?.additionalDetails === 'string'
            ? nestedError.additionalDetails
            : null
  return (
    [code ? `[${code}]` : null, message, details].filter(Boolean).join(' ')
    || 'Codex app-server reported an error'
  )
}

function readGeneratedCodexThreadTitleCandidate(title: string | null | undefined): string | null {
  const trimmed = title?.trim() ?? ''
  if (!trimmed) {
    return null
  }
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/u, '')
    .trim()
  try {
    const parsed = JSON.parse(unfenced) as { title?: unknown }
    if (typeof parsed.title === 'string') {
      return parsed.title
    }
  }
 catch {
    // Plain-text titles are the expected app-server output.
  }
  return unfenced.split('\n').map(line => line.trim()).find(Boolean) ?? null
}
