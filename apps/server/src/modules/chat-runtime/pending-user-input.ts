import type { UIMessageChunk } from 'ai'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import type { RuntimeKind } from '../provider-contracts/types'
import {
  recordRuntimeInteractionRequested,
  recordRuntimeInteractionResolved,
} from './interaction/event-recorder'
import type {
  RuntimeUiSlotState,
  RuntimeUserInputRequest,
  RuntimeUserInputResolution,
  RuntimeUserInputUiSlotState,
} from './runtime-provider-types'

interface PendingUserInputState {
  request: RuntimeUserInputRequest
  createdAt: number
  resolve: (resolution: RuntimeUserInputResolution) => void
  reject: (error: Error) => void
}

export interface PendingRuntimeUserInputSummary {
  sessionId: string
  runId: string
  requestId: string
  providerMethod: string
  toolCallId: string
  questionCount: number
  firstQuestion: string | null
  createdAt: number
  updatedAt: number
}

type RuntimeUserInputPublisher = (runId: string, chunk: UIMessageChunk) => void

const pendingUserInputById = new Map<string, PendingUserInputState>()
let publisher: RuntimeUserInputPublisher | null = null

export function setRuntimeUserInputPublisher(nextPublisher: RuntimeUserInputPublisher): void {
  publisher = nextPublisher
}

export async function requestRuntimeUserInput(
  input: RuntimeUserInputRequest,
): Promise<RuntimeUserInputResolution> {
  const pendingKey = readPendingKey(input.sessionId, input.providerRequestId)
  if (pendingUserInputById.has(pendingKey)) {
    return Promise.reject(
      new AppError({
        code: 'chat_runtime_user_input_duplicate',
        status: 409,
        message: 'Runtime user input request is already pending',
        details: { requestId: input.providerRequestId, sessionId: input.sessionId },
      }),
    )
  }

  const createdAt = currentUnixSeconds()
  const pending = new Promise<RuntimeUserInputResolution>((resolve, reject) => {
    pendingUserInputById.set(pendingKey, {
      request: input,
      createdAt,
      resolve,
      reject,
    })
  })

  try {
    await recordRuntimeInteractionRequested({
      sessionId: input.sessionId,
      runId: input.runId,
      requestId: input.providerRequestId,
      interactionKind: 'userInput',
      providerKind: input.providerKind,
      runtimeKind: input.runtimeKind,
      providerMethod: input.providerMethod,
      toolCallId: input.toolCallId,
      questionCount: input.questions.length,
      createdAt,
    })
  }
 catch (error) {
    const current = pendingUserInputById.get(pendingKey)
    if (current?.request === input) {
      pendingUserInputById.delete(pendingKey)
      current.reject(error instanceof Error ? error : new Error(String(error)))
    }
    throw error
  }

  return pending
}

export async function submitRuntimeUserInput(input: {
  sessionId: string
  requestId: string
  answers: Record<string, string[]>
}): Promise<RuntimeUserInputResolution> {
  const pendingKey = readPendingKey(input.sessionId, input.requestId)
  const pending = pendingUserInputById.get(pendingKey)
  if (!pending || pending.request.sessionId !== input.sessionId) {
    throw new AppError({
      code: 'chat_runtime_user_input_not_found',
      status: 404,
      message: 'Pending runtime user input request was not found',
      details: { requestId: input.requestId, sessionId: input.sessionId },
    })
  }

  pendingUserInputById.delete(pendingKey)
  const resolution: RuntimeUserInputResolution = {
    requestId: input.requestId,
    answers: input.answers,
  }
  pending.resolve(resolution)
  publisher?.(pending.request.runId, {
    type: 'tool-output-available',
    toolCallId: pending.request.toolCallId,
    output: {
      type: 'cradle.runtime-user-input.resolved.v1',
      requestId: input.requestId,
      answers: input.answers,
      acceptedAt: currentUnixSeconds(),
    },
  })
  await recordRuntimeInteractionResolved({
    sessionId: pending.request.sessionId,
    runId: pending.request.runId,
    requestId: input.requestId,
    interactionKind: 'userInput',
    resolution: 'submitted',
    updatedAt: currentUnixSeconds(),
  })
  return resolution
}

export function listPendingRuntimeUserInputStates(input: {
  sessionId: string
  slotId: string
  threadId: string | null
}): RuntimeUserInputUiSlotState[] {
  const states: RuntimeUserInputUiSlotState[] = []
  for (const pending of pendingUserInputById.values()) {
    if (pending.request.sessionId !== input.sessionId) {
      continue
    }
    states.push({
      kind: 'userInput',
      slotId: input.slotId,
      threadId: input.threadId,
      runId: pending.request.runId,
      requestId: pending.request.providerRequestId,
      providerMethod: pending.request.providerMethod,
      toolCallId: pending.request.toolCallId,
      questionCount: pending.request.questions.length,
      questions: pending.request.questions,
      createdAt: pending.createdAt,
      updatedAt: pending.createdAt,
    })
  }
  return states.sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId))
}

export function listPendingRuntimeUserInputSummaries(input: {
  sessionId?: string
  runId?: string
} = {}): PendingRuntimeUserInputSummary[] {
  const summaries: PendingRuntimeUserInputSummary[] = []
  for (const pending of pendingUserInputById.values()) {
    if (input.sessionId && pending.request.sessionId !== input.sessionId) {
      continue
    }
    if (input.runId && pending.request.runId !== input.runId) {
      continue
    }
    summaries.push({
      sessionId: pending.request.sessionId,
      runId: pending.request.runId,
      requestId: pending.request.providerRequestId,
      providerMethod: pending.request.providerMethod,
      toolCallId: pending.request.toolCallId,
      questionCount: pending.request.questions.length,
      firstQuestion: pending.request.questions[0]?.question ?? null,
      createdAt: pending.createdAt,
      updatedAt: pending.createdAt,
    })
  }
  return summaries.sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId))
}

export function appendPendingRuntimeUserInputSlotStates(
  states: RuntimeUiSlotState[],
  input: {
    sessionId: string
    runtimeKind: RuntimeKind
    threadId: string | null
  },
): RuntimeUiSlotState[] {
  const pendingStates = listPendingRuntimeUserInputStates({
    sessionId: input.sessionId,
    slotId: `${input.runtimeKind}:user-input`,
    threadId: input.threadId,
  })
  if (pendingStates.length === 0) {
    return states
  }
  const pendingRequestIds = new Set(pendingStates.map(state => state.requestId))
  return [
    ...states.filter(state =>
      state.kind !== 'userInput' || !pendingRequestIds.has(state.requestId)),
    ...pendingStates,
  ]
}

export function rejectPendingUserInputsForRun(runId: string, error: Error): void {
  for (const [requestId, pending] of pendingUserInputById) {
    if (pending.request.runId !== runId) {
      continue
    }
    pendingUserInputById.delete(requestId)
    pending.reject(error)
    void recordRuntimeInteractionResolved({
      sessionId: pending.request.sessionId,
      runId: pending.request.runId,
      requestId: pending.request.providerRequestId,
      interactionKind: 'userInput',
      resolution: 'cancelled',
      updatedAt: currentUnixSeconds(),
    }).catch(() => undefined)
  }
}

function readPendingKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
