import { useEffect } from 'react'

import type { GetWorkspacesResponse } from '~/api-gen/types.gen'
import { uiActivityBus } from '~/features/activity/activity-bus'
import { readUiActivityResolutionInputs } from '~/features/activity/resolution-inputs'
import { useSessionBinding } from '~/features/chat/session/use-session-binding'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useActiveSurface } from '~/navigation/active-surface'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'

import { codeActivityBus } from './code-activity-bus'
import {
  CodeActivitySourceEventSchema,
  openCodeActivityEvents,
} from './code-activity-events'
import {
  createCodeActivityTarget,
  resolveCodeActivityTarget,
} from './code-activity-resolver'

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

function isCodeActivityContextActive(
  sessionId: string,
  workspaceId: string,
): boolean {
  const inputs = readUiActivityResolutionInputs()
  if (
    !inputs.visible
    || inputs.activeSurface?.route.to !== '/chat/$sessionId'
    || inputs.activeSurface.route.params.sessionId !== sessionId
  ) {
    return false
  }

  const segment = uiActivityBus.getCurrentSegment()
  if (segment?.entityType === 'chat') {
    return segment.entity === `chat:${sessionId}`
  }
  return segment?.entityType === 'file'
    && inputs.activeBrowserTab?.kind === 'workspace-file'
    && inputs.activeBrowserTab.workspaceId === workspaceId
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

  useEffect(() => {
    if (!activeSessionId || !activeChatWorkspaceId) {
      return
    }

    let source: ReturnType<typeof openCodeActivityEvents>
    try {
      source = openCodeActivityEvents(activeSessionId)
    }
    catch (error) {
      console.warn('[code-activity] failed to observe session file events', error)
      return
    }
    let malformedFrameReported = false
    source.onmessage = (message) => {
      let rawEvent: unknown
      try {
        rawEvent = JSON.parse(message.data)
      }
      catch {
        rawEvent = null
      }
      const parsed = CodeActivitySourceEventSchema.safeParse(rawEvent)
      if (!parsed.success) {
        if (!malformedFrameReported) {
          malformedFrameReported = true
          console.warn('[code-activity] dropped malformed session file event', parsed.error)
        }
        return
      }
      const event = parsed.data
      if (
        event.type !== 'file-changed'
        || event.sessionId !== activeSessionId
        || event.workspace.id !== activeChatWorkspaceId
        || !isCodeActivityContextActive(activeSessionId, event.workspace.id)
      ) {
        return
      }
      codeActivityBus.publishWrite(createCodeActivityTarget(
        event.workspace,
        event.file.relativePath,
      ), event.occurredAt)
    }
    source.onerror = () => {
      // Fetch-backed SSE reconnects while this chat remains active.
    }

    return () => {
      source.close()
    }
  }, [
    activeChatWorkspaceId,
    activeSessionId,
  ])

  return null
}
