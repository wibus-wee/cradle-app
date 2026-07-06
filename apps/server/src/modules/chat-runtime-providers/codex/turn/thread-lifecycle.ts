/**
 * Output: Codex app-server thread lifecycle and history hydration helpers.
 * Input: runtime sessions, app-server clients, transcript snapshots, and native Codex history snapshots.
 * Position: Codex provider package owner for opening, restoring, and hydrating app-server threads.
 */

import type { UIMessage } from 'ai'

import type { RuntimeSession } from '../../../chat-runtime/runtime-provider-types'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { isCodexAppServerUnknownMethodError } from '../app-server/client'
import type { ThreadInjectItemsParams } from '../app-server-protocol/v2/ThreadInjectItemsParams'
import type { ThreadTurnsListResponse } from '../app-server-protocol/v2/ThreadTurnsListResponse'
import type { Turn } from '../app-server-protocol/v2/Turn'
import type { CodexNativeHistorySnapshot } from '../projection/state-projector'
import {
  readCodexProviderSnapshot,
  writeCodexNativeHistorySnapshot,
} from '../projection/state-projector'
import { codexRequestError, formatUnknownError } from '../provider-errors'
import type {
  CodexAppServerClientLike,
  CodexThreadStatus,
  ThreadResponse,
} from '../types'
import { projectCodexNativeTurnsToCodexItems } from './native-history-projector'
import { readCodexThreadDisplayTitle } from './stream-diagnostics'
import { projectCradleTranscriptToCodexItems } from './transcript-projector'

const CODEX_THREAD_TURNS_LIST_LIMIT = 100
const CODEX_SIDE_BOUNDARY_PROMPT = [
  'You are in a Cradle side conversation.',
  '',
  'Cradle owns this side boundary: this child session grows from the parent conversation context, but it is a separate workspace for exploration. Use the inherited context as background, do not treat the side conversation as a continuation that should mutate the parent transcript, and keep any conclusions local until the user explicitly carries them back.',
].join('\n')

export interface CodexThreadStart {
  threadId: string
  title: string | null
  modelId: string | null
  modelProvider: string | null
  serviceTier: string | null
  reasoningEffort: string | null
  status: CodexThreadStatus | null
}

export async function requestCodexAppServerWithTimeout<T>(
  client: CodexAppServerClientLike,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([
      client.request(method, params),
      timeoutPromise,
    ]) as T
  }
  finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export async function syncCodexSkillExtraRoots(
  client: CodexAppServerClientLike,
  extraRoots: string[],
): Promise<void> {
  if (extraRoots.length === 0) {
    return
  }
  try {
    await client.request('skills/extraRoots/set', { extraRoots })
  }
  catch (error) {
    if (isCodexAppServerUnknownMethodError(error, 'skills/extraRoots/set')) {
      return
    }
    throw codexRequestError('skills/extraRoots/set', formatUnknownError(error))
  }
}

export function isLiveCodexSideFork(runtimeSession: RuntimeSession): boolean {
  if (!runtimeSession.providerSessionId) {
    return false
  }
  const sideConversation = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.sideConversation
  return sideConversation?.liveFork === true
    && sideConversation.threadId === runtimeSession.providerSessionId
}

export function readLiveSideForkThreadStart(
  runtimeSession: RuntimeSession,
  fallbackModelId?: string | null,
): CodexThreadStart {
  if (!runtimeSession.providerSessionId) {
    throw codexRequestError('liveSideFork', 'Codex side conversation is missing a live thread id')
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  return {
    threadId: runtimeSession.providerSessionId,
    title: null,
    modelId: snapshot.codex?.model?.modelId ?? fallbackModelId ?? snapshot.models?.currentModelId ?? null,
    modelProvider: snapshot.codex?.model?.modelProvider ?? null,
    serviceTier: snapshot.codex?.model?.serviceTier ?? null,
    reasoningEffort: snapshot.codex?.reasoning?.effort ?? null,
    status: snapshot.codex?.status?.status ?? null,
  }
}

export async function startOrResumeThread(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  params: {
    model?: string | null
    cwd: string
    runtimeWorkspaceRoots: string[]
    approvalPolicy: CodexConfig['approvalPolicy']
    sandbox: CodexConfig['sandboxMode']
    config: Record<string, unknown>
    requestTimeoutMs?: number
  },
): Promise<CodexThreadStart> {
  const baseParams = {
    model: params.model,
    cwd: params.cwd,
    runtimeWorkspaceRoots: params.runtimeWorkspaceRoots,
    approvalPolicy: params.approvalPolicy,
    sandbox: params.sandbox,
    config: params.config,
  }
  const method = runtimeSession.providerSessionId ? 'thread/resume' : 'thread/start'
  const requestParams = runtimeSession.providerSessionId
    ? { ...baseParams, threadId: runtimeSession.providerSessionId, excludeTurns: true }
    : baseParams
  let response: ThreadResponse
  try {
    response = params.requestTimeoutMs
      ? await requestCodexAppServerWithTimeout<ThreadResponse>(client, method, requestParams, params.requestTimeoutMs)
      : await client.request(method, requestParams) as ThreadResponse
  }
  catch (error) {
    throw codexRequestError(method, formatUnknownError(error))
  }
  const threadId = response.thread?.id
  if (!threadId) {
    throw codexRequestError('startOrResumeCodexThread', 'Codex app-server did not return a thread id')
  }
  return {
    threadId,
    title: readCodexThreadDisplayTitle(response.thread),
    modelId: response.model ?? null,
    modelProvider: response.modelProvider ?? response.thread?.modelProvider ?? null,
    serviceTier: response.serviceTier ?? null,
    reasoningEffort: response.reasoningEffort ?? null,
    status: response.thread?.status ?? null,
  }
}

export async function injectCradleTranscriptHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  history: UIMessage[] | undefined,
): Promise<void> {
  if (!history?.length) {
    return
  }

  const items = projectCradleTranscriptToCodexItems(history)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

export async function injectCodexSideBoundary(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<void> {
  const params: ThreadInjectItemsParams = {
    threadId,
    items: [{
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: CODEX_SIDE_BOUNDARY_PROMPT,
      }],
    }],
  }
  await client.request('thread/inject_items', params)
}

export async function injectCodexNativeHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  nativeHistory: CodexNativeHistorySnapshot | undefined,
): Promise<void> {
  if (!nativeHistory?.turns.length) {
    return
  }

  const items = projectCodexNativeTurnsToCodexItems(nativeHistory.turns)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

export async function hydrateCodexNativeHistory(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  threadId: string,
): Promise<void> {
  try {
    const turns = await listFullCodexTurns(client, threadId)
    writeCodexNativeHistorySnapshot(runtimeSession, {
      threadId,
      itemsView: 'full',
      fetchedAt: Date.now(),
      complete: true,
      turns,
      turnCount: turns.length,
      itemCount: countCodexTurnItems(turns),
      nextCursor: null,
      error: null,
    })
  }
  catch (error) {
    writeCodexNativeHistorySnapshot(runtimeSession, {
      threadId,
      itemsView: 'full',
      fetchedAt: Date.now(),
      complete: false,
      turns: [],
      turnCount: 0,
      itemCount: 0,
      nextCursor: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function listFullCodexTurns(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<Turn[]> {
  const turns: Turn[] = []
  let cursor: string | null = null
  const seenCursors = new Set<string>()
  do {
    const response = await client.request('thread/turns/list', {
      threadId,
      cursor,
      limit: CODEX_THREAD_TURNS_LIST_LIMIT,
      sortDirection: 'asc',
      itemsView: 'full',
    }) as ThreadTurnsListResponse
    turns.push(...(Array.isArray(response.data) ? response.data : []))
    const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor.length > 0
      ? response.nextCursor
      : null
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw codexRequestError('hydrateCodexNativeHistory', `Codex thread/turns/list returned a repeated cursor: ${nextCursor}`)
    }
    if (nextCursor) {
      seenCursors.add(nextCursor)
    }
    cursor = nextCursor
  } while (cursor)
  return turns
}

function countCodexTurnItems(turns: Turn[]): number {
  return turns.reduce((count, turn) => count + turn.items.length, 0)
}
