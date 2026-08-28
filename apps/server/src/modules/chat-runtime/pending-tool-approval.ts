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

export function hasPendingRuntimeToolApproval(
  sessionId: string,
  options: { runId?: string } = {},
): boolean {
  for (const pending of pendingToolApprovalById.values()) {
    if (pending.request.sessionId !== sessionId) {
      continue
    }
    if (options.runId && pending.request.runId !== options.runId) {
      continue
    }
    return true
  }
  return false
}

export function listSessionIdsWithPendingRuntimeToolApproval(): Set<string> {
  return new Set(
    Array.from(pendingToolApprovalById.values(), pending => pending.request.sessionId),
  )
}

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

  void recordRuntimeToolApprovalInteraction(() => recordRuntimeInteractionRequested({
    sessionId: input.sessionId,
    runId: input.runId,
    requestId: input.providerRequestId,
    interactionKind: 'toolApproval',
    providerKind: input.providerKind,
    runtimeKind: input.runtimeKind,
    providerMethod: input.providerMethod,
    toolCallId: input.toolCallId,
    createdAt,
  }))

  return pending
}

export async function submitRuntimeToolApproval(input: {
  sessionId: string
  requestId: string
  approved: boolean
  scope?: 'once' | 'always'
  reason?: string
  selectedOptionId?: string
}): Promise<RuntimeToolApprovalResolution> {
  const submitted = submitRuntimeToolApprovalIfPendingWithEvent(input)
  if (submitted) {
    return submitted
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
  scope?: 'once' | 'always'
  reason?: string
  selectedOptionId?: string
}): RuntimeToolApprovalResolution | null {
  const submitted = submitRuntimeToolApprovalIfPendingWithEvent(input)
  if (!submitted) {
    return null
  }
  return submitted
}

function submitRuntimeToolApprovalIfPendingWithEvent(input: {
  sessionId: string
  requestId: string
  approved: boolean
  scope?: 'once' | 'always'
  reason?: string
  selectedOptionId?: string
}): RuntimeToolApprovalResolution | null {
  const pendingKey = readPendingKey(input.sessionId, input.requestId)
  const pending = pendingToolApprovalById.get(pendingKey)
  if (!pending || pending.request.sessionId !== input.sessionId) {
    return null
  }

  pendingToolApprovalById.delete(pendingKey)
  const resolution: RuntimeToolApprovalResolution = {
    requestId: input.requestId,
    approved: input.approved,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.selectedOptionId ? { selectedOptionId: input.selectedOptionId } : {}),
  }
  pending.resolve(resolution)
  void recordRuntimeToolApprovalInteraction(() => recordRuntimeInteractionResolved({
    sessionId: pending.request.sessionId,
    runId: pending.request.runId,
    requestId: input.requestId,
    interactionKind: 'toolApproval',
    resolution: 'submitted',
    approved: input.approved,
    updatedAt: currentUnixSeconds(),
  }))
  return resolution
}

export function rejectPendingToolApprovalsForRun(runId: string, error: Error): void {
  for (const [requestId, pending] of pendingToolApprovalById) {
    if (pending.request.runId !== runId) {
      continue
    }
    pendingToolApprovalById.delete(requestId)
    pending.reject(error)
    void recordRuntimeToolApprovalInteraction(() => recordRuntimeInteractionResolved({
      sessionId: pending.request.sessionId,
      runId: pending.request.runId,
      requestId: pending.request.providerRequestId,
      interactionKind: 'toolApproval',
      resolution: 'cancelled',
      updatedAt: currentUnixSeconds(),
    }))
  }
}

/**
 * Interaction facts are diagnostic/audit records. Their recorder can be a
 * synchronous database call, so catch both an immediate throw and an async
 * rejection without allowing either to abort the native approval handshake.
 */
function recordRuntimeToolApprovalInteraction(record: () => Promise<void>): Promise<void> {
  try {
    return record().catch(() => undefined)
  }
  catch {
    return Promise.resolve()
  }
}

function readPendingKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
