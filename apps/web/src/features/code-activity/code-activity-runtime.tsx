import { useEffect } from 'react'

import type { GetWorkspacesResponse } from '~/api-gen/types.gen'
import { uiActivityBus } from '~/features/activity/activity-bus'
import { readUiActivityResolutionInputs } from '~/features/activity/resolution-inputs'
import { useSessionBinding } from '~/features/chat/session/use-session-binding'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useActiveSurface } from '~/navigation/active-surface'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'

import { codeActivityBus } from './code-activity-bus'
import { resolveCodeActivityTarget } from './code-activity-resolver'

function syncCodeActivityTarget(
  workspaces: readonly GetWorkspacesResponse[number][],
  activeChatWorkspaceId: string | null,
): void {
  const segment = uiActivityBus.getCurrentSegment()
  if (!segment || segment.entityType !== 'file') {
    codeActivityBus.setCurrentTarget(null)
    return
  }

  const inputs = readUiActivityResolutionInputs()
  const target = resolveCodeActivityTarget(inputs, workspaces, activeChatWorkspaceId)
  codeActivityBus.setCurrentTarget(
    target?.file.relativePath === segment.entity ? target : null,
  )
}

export function CodeActivityRuntime(): null {
  const activeSessionId = chatSessionIdForSurface(useActiveSurface())
  const activeSession = useSessionBinding(activeSessionId, true)
  const { workspaces } = useWorkspaces()
  const activeChatWorkspaceId = activeSession?.workspaceId ?? null

  useEffect(() => {
    const subscription = uiActivityBus.subscribeHost('code-activity', () => {
      syncCodeActivityTarget(workspaces, activeChatWorkspaceId)
    })
    syncCodeActivityTarget(workspaces, activeChatWorkspaceId)

    return () => {
      subscription.dispose()
      codeActivityBus.clear()
    }
  }, [activeChatWorkspaceId, workspaces])

  return null
}
