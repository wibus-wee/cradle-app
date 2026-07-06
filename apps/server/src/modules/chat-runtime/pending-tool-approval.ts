import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import {
  recordRuntimeInteractionRequested,
  recordRuntimeInteractionResolved,
} from './interaction/event-recorder'
import type {
  RuntimeToolApprovalRequest,
  RuntimeToolApprovalResolution,
} from './runtime-provider-types'

interface PendingToolApprovalState {
  request: RuntimeToolApprovalRequest
  createdAt: number
  resolve: (resolution: RuntimeToolApprovalResolution) => void
  reject: (error: Error) => void
}

const pendingToolApprovalById = new Map<string, PendingToolApprovalState>()

export async function requestRuntimeToolApproval(
  input: RuntimeToolApprovalRequest,
): Promise<RuntimeToolApprovalResolution> {
  const pendingKey = readPendingKey(input.sessionId, input.providerRequestId)
  if (pendingToolApprovalById.has(pendingKey)) {
    return Promise.reject(
      new AppError({
        code: 'chat_runtime_tool_approval_duplicate',
        status: 409,
        message: 'Runtime tool approval request is already pending',
        details: { requestId: input.providerRequestId, sessionId: input.sessionId },
      }),
    )
  }

  const createdAt = currentUnixSeconds()
  const pending = new Promise<RuntimeToolApprovalResolution>((resolve, reject) => {
    pendingToolApprovalById.set(pendingKey, {
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
      interactionKind: 'toolApproval',
      providerKind: input.providerKind,
      runtimeKind: input.runtimeKind,
      providerMethod: input.providerMethod,
      toolCallId: input.toolCallId,
      createdAt,
    })
  }
 catch (error) {
    const current = pendingToolApprovalById.get(pendingKey)
    if (current?.request === input) {
      pendingToolApprovalById.delete(pendingKey)
      current.reject(error instanceof Error ? error : new Error(String(error)))
    }
    throw error
  }

  return pending
}

export async function submitRuntimeToolApproval(input: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
}): Promise<RuntimeToolApprovalResolution> {
  const submitted = submitRuntimeToolApprovalIfPendingWithEvent(input)
  if (submitted) {
    await submitted.eventRecorded
    return submitted.resolution
  }

  throw new AppError({
    code: 'chat_runtime_tool_approval_not_found',
    status: 404,
    message: 'Pending runtime tool approval request was not found',
    details: { requestId: input.requestId, sessionId: input.sessionId },
  })
}

export function submitRuntimeToolApprovalIfPending(input: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
}): RuntimeToolApprovalResolution | null {
  const submitted = submitRuntimeToolApprovalIfPendingWithEvent(input)
  if (!submitted) {
    return null
  }
  void submitted.eventRecorded.catch(() => undefined)
  return submitted.resolution
}

function submitRuntimeToolApprovalIfPendingWithEvent(input: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
}): { resolution: RuntimeToolApprovalResolution, eventRecorded: Promise<void> } | null {
  const pendingKey = readPendingKey(input.sessionId, input.requestId)
  const pending = pendingToolApprovalById.get(pendingKey)
  if (!pending || pending.request.sessionId !== input.sessionId) {
    return null
  }

  pendingToolApprovalById.delete(pendingKey)
  const resolution: RuntimeToolApprovalResolution = {
    requestId: input.requestId,
    approved: input.approved,
    ...(input.reason ? { reason: input.reason } : {}),
  }
  pending.resolve(resolution)
  return {
    resolution,
    eventRecorded: recordRuntimeInteractionResolved({
      sessionId: pending.request.sessionId,
      runId: pending.request.runId,
      requestId: input.requestId,
      interactionKind: 'toolApproval',
      resolution: 'submitted',
      approved: input.approved,
      updatedAt: currentUnixSeconds(),
    }),
  }
}

export function rejectPendingToolApprovalsForRun(runId: string, error: Error): void {
  for (const [requestId, pending] of pendingToolApprovalById) {
    if (pending.request.runId !== runId) {
      continue
    }
    pendingToolApprovalById.delete(requestId)
    pending.reject(error)
    void recordRuntimeInteractionResolved({
      sessionId: pending.request.sessionId,
      runId: pending.request.runId,
      requestId: pending.request.providerRequestId,
      interactionKind: 'toolApproval',
      resolution: 'cancelled',
      updatedAt: currentUnixSeconds(),
    }).catch(() => undefined)
  }
}

function readPendingKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
