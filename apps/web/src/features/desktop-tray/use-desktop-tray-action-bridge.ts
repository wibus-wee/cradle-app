import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'

import { getChatSessionsBySessionIdMessagesQueryKey, getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { runtimeUiSlotStatesQueryKey } from '~/features/chat/capabilities/chat-capabilities'
import { runtimeSettingsQueryKey } from '~/features/chat/commands/runtime-settings-command'
import { runtimeSessionStatusQueryKey } from '~/features/chat/runtime/use-runtime-session-status'
import { isSessionsQueryKey } from '~/features/workspace/use-session'
import { usePluginStore } from '~/lib/plugin-store'
import {
  openAutomation,
  openAwaits,
  openChatSession,
  openHome,
  openNewChat,
  openPluginPanel,
  openSettingsSection,
  openUsage,
} from '~/navigation/navigation-commands'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import type { TrayActionRequest } from './types'

interface DesktopTrayActionBridgeOptions {
  onOpenGlobalSearch: () => void
}

function readChatSessionIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const { sessionId } = payload as { sessionId?: unknown }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null
  }
  return sessionId
}

function openChatFromPayload(payload: unknown): boolean {
  const sessionId = readChatSessionIdFromPayload(payload)
  if (!sessionId) {
    return false
  }
  openChatSession(sessionId)
  return true
}

function refreshChatSessionQueries(queryClient: QueryClient, sessionId: string): void {
  void queryClient.invalidateQueries({
    queryKey: getChatSessionsBySessionIdMessagesQueryKey({ path: { sessionId } }),
  })
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdQueryKey({ path: { id: sessionId } }),
  })
  void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(sessionId) })
  void queryClient.invalidateQueries({ queryKey: ['chat', 'session-queue', sessionId] })
  void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
  void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(sessionId) })
  void queryClient.invalidateQueries({ predicate: query => isSessionsQueryKey(query.queryKey) })
}

function openSettingsRouteSection(section: string): void {
  const settingsStore = useSettingsOverlayStore.getState()
  settingsStore.setSettingsSection(section)
  openSettingsSection(section)
}

function openFirstPluginPanel(): boolean {
  const firstPanel = usePluginStore.getState().panels[0]
  if (!firstPanel) {
    return false
  }
  openPluginPanel({
    routeSegment: firstPanel.routeSegment,
    localId: firstPanel.localId,
  })
  return true
}

export function useDesktopTrayActionBridge({ onOpenGlobalSearch }: DesktopTrayActionBridgeOptions): void {
  const queryClient = useQueryClient()
  const handleRequest = useCallback((rawRequest: unknown) => {
    const request = rawRequest as TrayActionRequest

    switch (request.actionId) {
      case 'open-chat':
        openChatFromPayload(request.payload)
        return
      case 'chat-session-updated': {
        const sessionId = readChatSessionIdFromPayload(request.payload)
        if (sessionId) {
          refreshChatSessionQueries(queryClient, sessionId)
        }
        return
      }
      case 'new-chat':
        openNewChat()
        return
      case 'global-search':
        onOpenGlobalSearch()
        return
      case 'open-awaits':
        openAwaits()
        return
      case 'open-automation':
        openAutomation()
        return
      case 'open-workspaces':
        openHome()
        return
      case 'open-agents':
        openSettingsRouteSection('agents')
        return
      case 'open-providers':
        openSettingsRouteSection('providers')
        return
      case 'open-chronicle':
        openSettingsRouteSection('chronicle')
        return
      case 'open-usage':
        openUsage()
        return
      case 'open-plugins':
        if (!openFirstPluginPanel()) {
          openSettingsRouteSection('skills')
        }
        return
      case 'open-desktop-settings':
        openSettingsRouteSection('desktop')

      case 'open-app':
      case 'quit':
    }
  }, [onOpenGlobalSearch, queryClient])

  useEffect(() => {
    const unsubscribe = window.cradle?.desktopTray?.onActionRequested(handleRequest)

    void window.cradle?.desktopTray?.consumePendingActionRequests?.().then((requests) => {
      for (const request of requests as TrayActionRequest[]) {
        handleRequest(request)
      }
    })
    return unsubscribe ?? undefined
  }, [handleRequest])
}
