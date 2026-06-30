import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import type {
  RuntimeToolApprovalRequest,
  RuntimeToolApprovalResolution
} from './runtime-provider-types'

interface PendingToolApprovalState {
  request: RuntimeToolApprovalRequest
  createdAt: number
  resolve: (resolution: RuntimeToolApprovalResolution) => void
  reject: (error: Error) => void
}

const pendingToolApprovalById = new Map<string, PendingToolApprovalState>()

export function requestRuntimeToolApproval(
  input: RuntimeToolApprovalRequest
): Promise<RuntimeToolApprovalResolution> {
  const pendingKey = readPendingKey(input.sessionId, input.providerRequestId)
  if (pendingToolApprovalById.has(pendingKey)) {
    return Promise.reject(
      new AppError({
        code: 'chat_runtime_tool_approval_duplicate',
        status: 409,
        message: 'Runtime tool approval request is already pending',
        details: { requestId: input.providerRequestId, sessionId: input.sessionId }
      })
    )
  }

  return new Promise((resolve, reject) => {
    pendingToolApprovalById.set(pendingKey, {
      request: input,
      createdAt: currentUnixSeconds(),
      resolve,
      reject
    })
  })
}

export function submitRuntimeToolApproval(input: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
}): RuntimeToolApprovalResolution {
  const resolution = submitRuntimeToolApprovalIfPending(input)
  if (resolution) {
    return resolution
  }

  throw new AppError({
    code: 'chat_runtime_tool_approval_not_found',
    status: 404,
    message: 'Pending runtime tool approval request was not found',
    details: { requestId: input.requestId, sessionId: input.sessionId }
  })
}

export function submitRuntimeToolApprovalIfPending(input: {
  sessionId: string
  requestId: string
  approved: boolean
  reason?: string
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
    ...(input.reason ? { reason: input.reason } : {})
  }
  pending.resolve(resolution)
  return resolution
}

export function rejectPendingToolApprovalsForRun(runId: string, error: Error): void {
  for (const [requestId, pending] of pendingToolApprovalById) {
    if (pending.request.runId !== runId) {
      continue
    }
    pendingToolApprovalById.delete(requestId)
    pending.reject(error)
  }
}

function readPendingKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`
}
