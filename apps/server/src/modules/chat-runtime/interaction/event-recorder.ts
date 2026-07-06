import { commitSessionEvents } from '../es/commands'
import type { ChatSessionEvent } from '../es/events'

export type RuntimeInteractionKind = 'toolApproval' | 'userInput'
export type RuntimeInteractionResolution = 'submitted' | 'cancelled'

type RuntimeInteractionEventRecorder = (
  sessionId: string,
  events: ChatSessionEvent[],
) => Promise<void>

let runtimeInteractionEventRecorder: RuntimeInteractionEventRecorder = async () => undefined

export function setRuntimeInteractionEventRecorder(
  recorder: RuntimeInteractionEventRecorder,
): void {
  runtimeInteractionEventRecorder = recorder
}

export function resetRuntimeInteractionEventRecorder(): void {
  runtimeInteractionEventRecorder = async () => undefined
}

export function recordRuntimeInteractionEventToSessionEvents(
  sessionId: string,
  events: ChatSessionEvent[],
): Promise<void> {
  return commitSessionEvents(sessionId, events)
}

export function recordRuntimeInteractionRequested(input: {
  sessionId: string
  runId: string
  requestId: string
  interactionKind: RuntimeInteractionKind
  providerKind: string
  runtimeKind: string
  providerMethod: string
  toolCallId: string
  questionCount?: number
  createdAt: number
}): Promise<void> {
  return runtimeInteractionEventRecorder(input.sessionId, [
    {
      type: 'InteractionRequested',
      payload: {
        sessionId: input.sessionId,
        runId: input.runId,
        requestId: input.requestId,
        interactionKind: input.interactionKind,
        providerKind: input.providerKind,
        runtimeKind: input.runtimeKind,
        providerMethod: input.providerMethod,
        toolCallId: input.toolCallId,
        questionCount: input.questionCount ?? null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
    },
  ])
}

export function recordRuntimeInteractionResolved(input: {
  sessionId: string
  runId: string
  requestId: string
  interactionKind: RuntimeInteractionKind
  resolution: RuntimeInteractionResolution
  approved?: boolean
  updatedAt: number
}): Promise<void> {
  return runtimeInteractionEventRecorder(input.sessionId, [
    {
      type: 'InteractionResolved',
      payload: {
        sessionId: input.sessionId,
        runId: input.runId,
        requestId: input.requestId,
        interactionKind: input.interactionKind,
        resolution: input.resolution,
        approved: input.approved ?? null,
        updatedAt: input.updatedAt,
      },
    },
  ])
}
