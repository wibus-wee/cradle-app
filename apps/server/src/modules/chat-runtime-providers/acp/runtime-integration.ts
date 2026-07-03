import { randomUUID } from 'node:crypto'

import * as ChatRuntime from '../../chat-runtime/runtime'
import type { ProviderContext } from '../../chat-runtime/runtime-provider-types'
import { listChatSessionIdsByDurableProviderSession } from '../../provider-runtime/service'
import { requestProviderToolApproval } from '../kit/permission-bridge'
import type { AcpConnectionManager, AcpPermissionRequest, AcpPermissionResponse } from './connection-manager'

export interface AcpIntegrationOptions {
  deps: Pick<ProviderContext, 'requestToolApproval'>
}

export function wireAcpIntegration(runtime: AcpConnectionManager, options: AcpIntegrationOptions): void {
  runtime.setPermissionHandler(request => handlePermission(request, options))
  runtime.onSessionTitle((acpSessionId, title) => {
    handleSessionTitle(acpSessionId, title)
  })
}

async function handlePermission(
  request: AcpPermissionRequest,
  options: AcpIntegrationOptions,
): Promise<AcpPermissionResponse> {
  const runtimeContext = request.runtimeContext
  const chatSessionId = runtimeContext?.chatSessionId ?? listChatSessionIdsByDurableProviderSession(request.sessionId)[0] ?? null
  if (!runtimeContext) {
    console.warn('[acp] permission request denied because active runtime context is unavailable', {
      agentId: request.agentId,
      chatSessionId,
      toolTitle: request.toolTitle,
    })
    return denyAcpPermission(request)
  }

  const requestId = `acp-permission-${randomUUID()}`
  try {
    const resolution = await requestProviderToolApproval({
      deps: options.deps,
      sessionId: runtimeContext.chatSessionId,
      runId: runtimeContext.runId,
      providerRequestId: requestId,
      providerKind: runtimeContext.providerKind,
      runtimeKind: runtimeContext.runtimeKind,
      providerMethod: request.providerMethod,
      toolCallId: requestId,
      metadata: {
        acpSessionId: request.sessionId,
        agentId: request.agentId,
        toolTitle: request.toolTitle,
        options: request.options,
      },
    })

    if (!resolution.approved) {
      return denyAcpPermission(request)
    }

    return allowAcpPermission(request)
  }
  catch (error) {
    console.warn('[acp] permission request denied because runtime approval failed', {
      agentId: request.agentId,
      chatSessionId,
      toolTitle: request.toolTitle,
      error,
    })
    return denyAcpPermission(request)
  }
}

function handleSessionTitle(acpSessionId: string, title: string): void {
  for (const chatSessionId of listChatSessionIdsByDurableProviderSession(acpSessionId)) {
    void ChatRuntime.reportRuntimeSessionTitle({ sessionId: chatSessionId, title }).catch(
      (error) => {
        console.warn('[acp] session title persistence failed', {
          acpSessionId,
          chatSessionId,
          error,
        })
      },
    )
  }
}

function allowAcpPermission(request: AcpPermissionRequest): AcpPermissionResponse {
  const allowOption = request.options.find(
    option => option.kind === 'allow_once' || option.kind === 'allow_always',
  )
  return allowOption
    ? { outcome: 'selected', optionId: allowOption.optionId }
    : { outcome: 'cancelled' }
}

function denyAcpPermission(request: AcpPermissionRequest): AcpPermissionResponse {
  const rejectOption = request.options.find(
    option => option.kind === 'reject_once' || option.kind === 'reject_always',
  )
  return rejectOption
    ? { outcome: 'selected', optionId: rejectOption.optionId }
    : { outcome: 'cancelled' }
}
