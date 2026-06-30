import * as ChatRuntime from '../../chat-runtime/service'
import { listChatSessionIdsByDurableProviderSession } from '../../provider-runtime/service'
import type { AcpConnectionManager } from './connection-manager'

export function wireAcpIntegration(runtime: AcpConnectionManager): void {
  runtime.setPermissionHandler(request => handlePermission(request))
  runtime.onSessionTitle((acpSessionId, title) => {
    handleSessionTitle(acpSessionId, title)
  })
}

async function handlePermission(request: {
  agentId: string
  sessionId: string
  toolTitle: string
  options: Array<{ optionId: string, name: string, kind: string }>
}): Promise<{ outcome: 'selected' | 'cancelled', optionId?: string }> {
  const chatSessionId = listChatSessionIdsByDurableProviderSession(request.sessionId)[0] ?? null
  const rejectOption = request.options.find(option => option.kind === 'reject_once' || option.kind === 'reject_always')
  console.warn('[acp] permission request denied because legacy approval SSE is removed', {
    agentId: request.agentId,
    chatSessionId,
    toolTitle: request.toolTitle,
  })
  return rejectOption
    ? { outcome: 'selected', optionId: rejectOption.optionId }
    : { outcome: 'cancelled' }
}

function handleSessionTitle(acpSessionId: string, title: string): void {
  for (const chatSessionId of listChatSessionIdsByDurableProviderSession(acpSessionId)) {
    void ChatRuntime.reportRuntimeSessionTitle({ sessionId: chatSessionId, title }).catch(error => {
      console.warn('[acp] session title persistence failed', {
        acpSessionId,
        chatSessionId,
        error,
      })
    })
  }
}
