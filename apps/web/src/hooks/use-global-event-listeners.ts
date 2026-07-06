import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import type { UIMessageChunk } from 'ai'
import { useEffect } from 'react'

import { getChatSessionsBySessionIdMessagesQueryKey, getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postSessionsByIdRead } from '~/api-gen/sdk.gen'
import { runtimeUiSlotStatesQueryKey } from '~/features/chat/capabilities/chat-capabilities'
import { runtimeSettingsQueryKey } from '~/features/chat/commands/runtime-settings-command'
import { runtimeSessionStatusQueryKey } from '~/features/chat/runtime/use-runtime-session-status'
import { onAnyChatRunEvent, onChatRunSettled } from '~/features/chat/transport/sse-chat-transport'
import { useGlobalSessionEventSync } from '~/features/workspace/use-global-session-event-sync'
import { isSessionsQueryKey, updateSessionReadState } from '~/features/workspace/use-session'
import { isElectron, isTearoffWindow, nativeIpc, platform } from '~/lib/electron'
import { useActiveSurface } from '~/navigation/active-surface'
import { activateAdjacentSurface, closeActiveSurface, openNewChat } from '~/navigation/navigation-commands'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import {
  BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL,
  handleBrowserPanelTabShortcut,
  handleBrowserPanelTabShortcutPayload,
} from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSessionActivityStore } from '~/store/session-activity'

function invalidateChatSessionRuntimeQueries(queryClient: QueryClient, sessionId: string): void {
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

function isClaudeEnterPlanModeChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === 'tool-input-start' && chunk.toolName === 'EnterPlanMode'
}

function isOpenExternalTerminalShortcut(event: KeyboardEvent): boolean {
  const isKeyC = event.key === 'c' || event.key === 'C' || event.code === 'KeyC'
  if (!isKeyC || !event.shiftKey || event.altKey) {
    return false
  }
  if (platform === 'darwin') {
    return event.metaKey && !event.ctrlKey
  }
  return event.ctrlKey && !event.metaKey
}

export function useGlobalEventListeners(options: {
  workspacePath?: string | null
} = {}) {
  const queryClient = useQueryClient()
  useGlobalSessionEventSync(queryClient)
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const toggleAside = useLayoutStore(s => s.toggleAside)
  const visibleSessionId = chatSessionIdForSurface(useActiveSurface())
  const workspacePath = options.workspacePath

  // Panel + tab keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isBackquote = e.key === '`' || e.code === 'Backquote'
      const isKeyB = e.key === 'b' || e.key === 'B' || e.key === '∫' || e.code === 'KeyB'

      // Ctrl+` → toggle bottom panel
      if (e.ctrlKey && !e.metaKey && !e.altKey && isBackquote) {
        e.preventDefault()
        toggleBottomPanel()
        return
      }
      // Cmd+Option+B → toggle right aside (e.key is '∫' on macOS when Option is held)
      if (e.metaKey && e.altKey && !e.ctrlKey && isKeyB) {
        e.preventDefault()
        toggleAside()
        return
      }
      // Cmd+Shift+C on macOS, Ctrl+Shift+C elsewhere -> open external terminal.
      if (isElectron && nativeIpc && workspacePath && isOpenExternalTerminalShortcut(e)) {
        e.preventDefault()
        void nativeIpc.native.openPathInTerminal(workspacePath).catch((error) => {
          console.error('Failed to open external terminal', error)
        })
        return
      }

      // ── Tab shortcuts ──────────────────────────────────────────────
      const layoutState = useLayoutStore.getState()
      if (handleBrowserPanelTabShortcut(e, {
        panelOpen: layoutState.browserPanelOpen,
        ownerId: layoutState.activeBrowserPanelOwnerId,
        onCloseLastTab: ownerId => useLayoutStore.getState().setBrowserPanelOpen(false, ownerId),
      })) {
        return
      }

      // Cmd+W -> close active surface
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'w') {
        e.preventDefault()
        if (isTearoffWindow) {
          void nativeIpc?.window.close().catch(() => {})
          return
        }
        closeActiveSurface()
        return
      }

      if (isTearoffWindow) {
        return
      }

      // Cmd+T -> new chat surface
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        openNewChat()
        return
      }

      // Ctrl+Tab / Ctrl+Shift+Tab -> cycle surfaces
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault()
        activateAdjacentSurface(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [toggleBottomPanel, toggleAside, workspacePath])

  useEffect(() => {
    return window.cradle?.ipc.on(BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL, (payload) => {
      const layoutState = useLayoutStore.getState()
      handleBrowserPanelTabShortcutPayload(payload, {
        panelOpen: layoutState.browserPanelOpen,
        ownerId: layoutState.activeBrowserPanelOwnerId,
        onCloseLastTab: ownerId => useLayoutStore.getState().setBrowserPanelOpen(false, ownerId),
      })
    }) ?? (() => {})
  }, [])

  useEffect(() => {
    useSessionActivityStore.getState().setVisibleSession(visibleSessionId)
    if (!visibleSessionId) {
      return
    }

    void postSessionsByIdRead({ path: { id: visibleSessionId } })
      .then(({ data }) => {
        if (data) {
          updateSessionReadState(queryClient, data)
        }
      })
      .catch(() => {})
  }, [queryClient, visibleSessionId])

  useEffect(() => {
    return onChatRunSettled(({ chatSessionId }) => {
      invalidateChatSessionRuntimeQueries(queryClient, chatSessionId)
      if (useSessionActivityStore.getState().visibleSessionId === chatSessionId) {
        void postSessionsByIdRead({ path: { id: chatSessionId } })
          .then(({ data }) => {
            if (data) {
              updateSessionReadState(queryClient, data)
            }
          })
          .catch(() => {})
      }
    })
  }, [queryClient])

  useEffect(() => {
    return onAnyChatRunEvent(({ chatSessionId, chunk }) => {
      if (chunk.type === 'start') {
        invalidateChatSessionRuntimeQueries(queryClient, chatSessionId)
        return
      }
      if (isClaudeEnterPlanModeChunk(chunk)) {
        void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(chatSessionId) })
        void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(chatSessionId) })
      }
    })
  }, [queryClient])
}
