import type {
  ProviderContext,
  ProviderKind,
  RuntimeKind,
  RuntimeToolApprovalRequest,
  RuntimeToolApprovalResolution,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'

const DEFAULT_MISSING_HANDLER_DETAIL = 'Chat Runtime does not expose pending tool approval handling'

export interface ProviderToolApprovalRequestInput {
  sessionId: string
  runId: string
  providerRequestId: string
  providerKind: ProviderKind
  runtimeKind: RuntimeKind
  providerMethod: string
  toolCallId: string
  metadata?: Record<string, unknown>
}

export interface ProviderToolApprovalBridgeInput extends ProviderToolApprovalRequestInput {
  deps: Pick<ProviderContext, 'requestToolApproval'>
  missingHandlerDetail?: string
}

export function buildProviderToolApprovalRequest(input: ProviderToolApprovalRequestInput): RuntimeToolApprovalRequest {
  const request: RuntimeToolApprovalRequest = {
    sessionId: input.sessionId,
    runId: input.runId,
    providerRequestId: input.providerRequestId,
    providerKind: input.providerKind,
    runtimeKind: input.runtimeKind,
    providerMethod: input.providerMethod,
    toolCallId: input.toolCallId,
  }

  if (input.metadata !== undefined) {
    request.metadata = input.metadata
  }

  return request
}

export async function requestProviderToolApproval(input: ProviderToolApprovalBridgeInput): Promise<RuntimeToolApprovalResolution> {
  const requestToolApproval = input.deps.requestToolApproval
  if (!requestToolApproval) {
    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        input.runtimeKind,
        input.providerMethod,
        input.missingHandlerDetail ?? DEFAULT_MISSING_HANDLER_DETAIL,
      ),
    )
  }

  return await requestToolApproval(buildProviderToolApprovalRequest(input))
}
