import type { UIMessageChunk } from 'ai'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import type { RuntimeKind } from '../provider-contracts/types'
import type {
  RuntimeUserInputRequest,
  RuntimeUserInputResolution,
  RuntimeUserInputUiSlotState,
  RuntimeUiSlotState
} from './runtime-provider-types'

interface PendingUserInputState {
  request: RuntimeUserInputRequest
  createdAt: number
  resolve: (resolution: RuntimeUserInputResolution) => void
  reject: (error: Error) => void
}

type RuntimeUserInputPublisher = (runId: string, chunk: UIMessageChunk) => void

const pendingUserInputById = new Map<string, PendingUserInputState>()
let publisher: RuntimeUserInputPublisher | null = null

export function setRuntimeUserInputPublisher(nextPublisher: RuntimeUserInputPublisher): void {
  publisher = nextPublisher
}

export function requestRuntimeUserInput(
  input: RuntimeUserInputRequest
): Promise<RuntimeUserInputResolution> {
  const pendingKey = readPendingKey(input.sessionId, input.providerRequestId)
  if (pendingUserInputById.has(pendingKey)) {
    return Promise.reject(
      new AppError({
        code: 'chat_runtime_user_input_duplicate',
        status: 409,
        message: 'Runtime user input request is already pending',
        details: { requestId: input.providerRequestId, sessionId: input.sessionId }
      })
    )
  }

  return new Promise((resolve, reject) => {
    pendingUserInputById.set(pendingKey, {
      request: input,
      createdAt: currentUnixSeconds(),
      resolve,
      reject
    })
  })
}

export function submitRuntimeUserInput(input: {
  sessionId: string
  requestId: string
  answers: Record<string, string[]>
}): RuntimeUserInputResolution {
  const pendingKey = readPendingKey(input.sessionId, input.requestId)
  const pending = pendingUserInputById.get(pendingKey)
  if (!pending || pending.request.sessionId !== input.sessionId) {
    throw new AppError({
      code: 'chat_runtime_user_input_not_found',
      status: 404,
      message: 'Pending runtime user input request was not found',
      details: { requestId: input.requestId, sessionId: input.sessionId }
    })
  }

  pendingUserInputById.delete(pendingKey)
  const resolution: RuntimeUserInputResolution = {
    requestId: input.requestId,
    answers: input.answers
  }
  pending.resolve(resolution)
  publisher?.(pending.request.runId, {
    type: 'tool-output-available',
    toolCallId: pending.request.toolCallId,
    output: {
      type: 'cradle.runtime-user-input.resolved.v1',
      requestId: input.requestId,
      answers: input.answers,
      acceptedAt: currentUnixSeconds()
    }
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
      updatedAt: pending.createdAt
    })
  }
  return states.sort((a, b) => a.createdAt - b.createdAt || a.requestId.localeCompare(b.requestId))
}

export function appendPendingRuntimeUserInputSlotStates(
  states: RuntimeUiSlotState[],
  input: {
    sessionId: string
    runtimeKind: RuntimeKind
    threadId: string | null
  }
): RuntimeUiSlotState[] {
  const pendingStates = listPendingRuntimeUserInputStates({
    sessionId: input.sessionId,
    slotId: `${input.runtimeKind}:user-input`,
    threadId: input.threadId
  })
  return pendingStates.length > 0 ? [...states, ...pendingStates] : states
}

export function rejectPendingUserInputsForRun(runId: string, error: Error): void {
  for (const [requestId, pending] of pendingUserInputById) {
    if (pending.request.runId !== runId) {
      continue
    }
    pendingUserInputById.delete(requestId)
    pending.reject(error)
  }
}

function readPendingKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
