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

/**
 * Provider-specific behavior around the shared approval flow, supplied by the caller instead of
 * each provider hand-rolling its own pre-checks around `requestProviderToolApproval`.
 */
export interface ProviderToolApprovalPolicy {
  /**
   * Runs before the runtime's pending-tool-approval hook is invoked. Return a resolution to
   * short-circuit the approval entirely (e.g. an SDK-level "bypass permissions" mode that should
   * auto-approve, or a runtime mode that should auto-deny without round-tripping through the
   * user) — return `null`/`undefined` to proceed with the normal approval flow.
   */
  resolveOverride?: () => RuntimeToolApprovalResolution | null | undefined
  /** Extend/replace the request metadata with provider-specific fields (e.g. SDK request options). */
  describeRequest?: (
    metadata: Record<string, unknown> | undefined,
  ) => Record<string, unknown> | undefined
  /**
   * Runs once `resolveOverride` has been checked and found no shortcut, immediately before the
   * runtime's pending-tool-approval hook is invoked. Lets provider-specific side effects (e.g.
   * publishing a "tool approval requested" UI event) fire only when an approval round-trip is
   * genuinely about to happen, not when `resolveOverride` short-circuited it.
   */
  onBeforeDispatch?: () => void
}

export interface ProviderToolApprovalBridgeInput extends ProviderToolApprovalRequestInput {
  deps: Pick<ProviderContext, 'requestToolApproval'>
  missingHandlerDetail?: string
  policy?: ProviderToolApprovalPolicy
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
  const override = input.policy?.resolveOverride?.()
  if (override) {
    return override
  }

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

  input.policy?.onBeforeDispatch?.()

  const metadata = input.policy?.describeRequest
    ? input.policy.describeRequest(input.metadata)
    : input.metadata

  return await requestToolApproval(buildProviderToolApprovalRequest({ ...input, metadata }))
}
