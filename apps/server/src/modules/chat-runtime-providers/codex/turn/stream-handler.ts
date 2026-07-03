/**
 * Output: Codex turn notification stream helpers and provider-thread event fanout.
 * Input: app-server client notifications, active goal snapshots, and provider-thread subscribers.
 * Position: Codex provider package owner for single-turn stream notification orchestration.
 */

import type { UIMessageChunk } from 'ai'

import type { ProviderThreadEvent } from '../../../chat-runtime/runtime-provider-types'
import { providerChunk } from '../../kit/chunk-mapper'
import type { CodexAppServerMessage } from '../app-server/client'
import type { CodexAppServerMapperState } from './event-to-chunk-mapper'
import {
  closeOpenCodexAppServerReasoning,
  closeOpenCodexAppServerText,
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './event-to-chunk-mapper'
import type { CodexStreamDiagnostics } from './stream-diagnostics'
import {
  collectCodexStreamDiagnostics,
  createCodexAppServerError,
  createCodexTurnFailureError,
  getNotificationTurnId,
  getThreadId,
  getTurnId,
  isRetryableCodexAppServerError,
} from './stream-diagnostics'

const ACTIVE_GOAL_CONTINUATION_DELAY_MS = 250

interface CodexAppServerClientLike {
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: (signal?: AbortSignal) => Promise<CodexAppServerMessage | null>
}

interface CodexGoalLike {
  objective?: string | null
  status?: string | null
}

export interface CodexMappedTurnEvent {
  notification: CodexAppServerMessage
  chunks: UIMessageChunk[]
  retryableError: boolean
}

interface ThreadStatusChangedNotificationParams {
  status?: { type?: string }
}

interface TurnCompletedNotificationParams {
  turn?: {
    id?: string
    status?: string
    error?: { message?: string } | null
  }
}

interface CodexGoalUpdatedNotificationParams {
  goal?: { status?: string | null }
}

export function isCompletedGoalUpdate(notification: CodexAppServerMessage): boolean {
  if (notification.method !== 'thread/goal/updated') {
    return false
  }
  const params = notification.params as CodexGoalUpdatedNotificationParams | undefined
  return params?.goal?.status === 'complete'
}

export function publishProviderThreadEvent(
  onProviderThreadEvent: ((event: ProviderThreadEvent) => void) | undefined,
  notification: CodexAppServerMessage,
  mapperStates: Map<string, ReturnType<typeof createCodexAppServerMapperState>>,
): void {
  if (!onProviderThreadEvent) {
    return
  }
  const providerThreadId = getThreadId(notification)
  if (!providerThreadId) {
    return
  }
  try {
    let state = mapperStates.get(providerThreadId)
    if (!state) {
      state = createCodexAppServerMapperState(`provider-thread:${providerThreadId}`)
      mapperStates.set(providerThreadId, state)
    }
      const chunks = mapCodexAppServerNotificationToChunks(notification, state)
      if (notification.method === 'turn/completed') {
        chunks.push(...closeOpenCodexAppServerReasoning(state))
        chunks.push(...closeOpenCodexAppServerText(state))
        chunks.push(providerChunk.finish('stop'))
      }
    if (chunks.length === 0) {
      return
    }
    onProviderThreadEvent({
      providerThreadId,
      providerTurnId: getNotificationTurnId(notification),
      notification,
      chunks,
    })
  }
  catch {
    // Provider-thread subscribers must not affect the parent turn stream.
  }
}

export async function* readTurnNotifications(
  client: CodexAppServerClientLike,
  threadId: string,
  initialTurnId: string | null,
  signal: AbortSignal,
  readGoal: () => CodexGoalLike | null | undefined,
  onProviderNotification?: (notification: CodexAppServerMessage) => void,
): AsyncGenerator<CodexAppServerMessage, void, void> {
  let turnId = initialTurnId
  let turnCompleted = false
  while (!signal.aborted) {
    let notification: CodexAppServerMessage | null
    try {
      notification = await client.nextNotification(signal)
    }
    catch (error) {
      if (signal.aborted) {
        return
      }
      throw error
    }
    if (!notification) {
      return
    }
    onProviderNotification?.(notification)
    const notificationThreadId = getThreadId(notification)
    if (notificationThreadId && notificationThreadId !== threadId) {
      continue
    }
    if (notification.method === 'turn/started') {
      turnId = getTurnId(notification)
      turnCompleted = false
      yield notification
      continue
    }
    const notificationTurnId = getNotificationTurnId(notification)
    if (turnId && notificationTurnId && notificationTurnId !== turnId) {
      continue
    }
    yield notification
    if (notification.method === 'turn/completed') {
      turnCompleted = true
      if (!hasActiveGoal(readGoal())) {
        return
      }
      continue
    }
    if (turnCompleted && isIdleThreadStatus(notification)) {
      if (!hasActiveGoal(readGoal())) {
        return
      }
      if (!await continueActiveGoal(client, threadId, signal)) {
        return
      }
      turnId = null
      turnCompleted = false
    }
    if (turnCompleted) {
      if (!hasActiveGoal(readGoal())) {
        return
      }
    }
  }
}

export async function* streamCodexMappedTurnEvents(input: {
  client: CodexAppServerClientLike
  threadId: string
  turnId: string | null
  signal: AbortSignal
  mapperState: CodexAppServerMapperState
  diagnostics: CodexStreamDiagnostics
  readGoal: () => CodexGoalLike | null | undefined
  onProviderNotification?: (notification: CodexAppServerMessage) => void
}): AsyncGenerator<CodexMappedTurnEvent, void, void> {
  for await (const notification of readTurnNotifications(
    input.client,
    input.threadId,
    input.turnId,
    input.signal,
    input.readGoal,
    input.onProviderNotification,
  )) {
    if (input.signal.aborted) {
      break
    }

    collectCodexStreamDiagnostics(input.diagnostics, notification)
    const chunks = mapCodexAppServerNotificationToChunks(notification, input.mapperState)
    input.diagnostics.mappedEvents += chunks.length

    if (notification.method === 'turn/completed') {
      const turn = (notification.params as TurnCompletedNotificationParams | undefined)?.turn
      if (turn?.status === 'failed') {
        throw createCodexTurnFailureError(turn.error?.message, input.diagnostics, notification)
      }
    }

    if (notification.method === 'error') {
      if (isRetryableCodexAppServerError(notification)) {
        yield { notification, chunks, retryableError: true }
        continue
      }
      throw createCodexAppServerError(notification, input.diagnostics)
    }

    yield { notification, chunks, retryableError: false }
  }
}

export function closeCodexMappedTurnChunks(
  mapperState: CodexAppServerMapperState,
  diagnostics?: CodexStreamDiagnostics,
): UIMessageChunk[] {
  const chunks = [
    ...closeOpenCodexAppServerReasoning(mapperState),
    ...closeOpenCodexAppServerText(mapperState),
  ]
  if (diagnostics) {
    diagnostics.mappedEvents += chunks.length
  }
  return chunks
}

export async function continueActiveGoal(
  client: Pick<CodexAppServerClientLike, 'request'>,
  threadId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!await waitForActiveGoalContinuationDelay(signal)) {
    return false
  }
  await client.request('thread/goal/set', { threadId, status: 'active' })
  return true
}

function isIdleThreadStatus(notification: CodexAppServerMessage): boolean {
  if (notification.method !== 'thread/status/changed') {
    return false
  }
  const params = notification.params as ThreadStatusChangedNotificationParams | undefined
  return params?.status?.type === 'idle'
}

function hasActiveGoal(goal: CodexGoalLike | null | undefined): boolean {
  return goal?.status === 'active' && typeof goal.objective === 'string' && goal.objective.trim().length > 0
}

function waitForActiveGoalContinuationDelay(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ACTIVE_GOAL_CONTINUATION_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
