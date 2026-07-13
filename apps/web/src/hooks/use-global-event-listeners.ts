import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import type { UIMessageChunk } from 'ai'
import { useCallback, useEffect } from 'react'

import {
  getChatSessionsBySessionIdMessagesQueryKey,
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { postSessionsByIdRead } from '~/api-gen/sdk.gen'
import { runtimeUiSlotStatesQueryKey } from '~/features/chat/capabilities/chat-capabilities'
import { runtimeSettingsQueryKey } from '~/features/chat/commands/runtime-settings-command'
import { runtimeSessionStatusQueryKey } from '~/features/chat/runtime/use-runtime-session-status'
import { onAnyChatRunEvent, onChatRunSettled } from '~/features/chat/transport/sse-chat-transport'
import { useGlobalSessionEventSync } from '~/features/workspace/use-global-session-event-sync'
import { isSessionsQueryKey, updateSessionReadState } from '~/features/workspace/use-session'
import { useShortcut } from '~/hooks/use-shortcut'
import { isElectron, isTearoffWindow, nativeIpc, platform } from '~/lib/electron'
import { useActiveSurface } from '~/navigation/active-surface'
import {
  activateAdjacentSurface,
  closeActiveSurface,
  openNewChat,
} from '~/navigation/navigation-commands'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import {
  BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL,
  handleBrowserPanelTabShortcut,
  handleBrowserPanelTabShortcutPayload,
  useBrowserPanelStore,
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

export function useGlobalEventListeners(
  options: {
    workspacePath?: string | null
  } = {},
) {
  const queryClient = useQueryClient()
  useGlobalSessionEventSync(queryClient)
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const toggleAside = useLayoutStore(s => s.toggleAside)
  const visibleSessionId = chatSessionIdForSurface(useActiveSurface())
  const workspacePath = options.workspacePath

  useShortcut('layout.toggle-bottom-panel', { ctrl: true, key: '`' }, toggleBottomPanel)
  useShortcut('layout.toggle-aside', { meta: true, alt: true, key: 'b' }, toggleAside)
  useShortcut(
    'terminal.open-external',
    {
      ...(platform === 'darwin' ? { meta: true } : { ctrl: true }),
      shift: true,
      key: 'c',
    },
    useCallback(() => {
      if (!isElectron || !nativeIpc || !workspacePath) {
        return
      }
      void nativeIpc.native.openPathInTerminal(workspacePath).catch((error) => {
        console.error('Failed to open external terminal', error)
      })
    }, [workspacePath]),
    Boolean(workspacePath),
  )
  useShortcut(
    'surface.close',
    { meta: true, key: 'w' },
    useCallback(() => {
      if (isTearoffWindow) {
        void nativeIpc?.window.close().catch(() => {})
        return
      }
      closeActiveSurface()
    }, []),
  )
  useShortcut('chat.new', { meta: true, key: 't' }, openNewChat, !isTearoffWindow)
  useShortcut(
    'surface.next',
    { ctrl: true, key: 'Tab' },
    () => activateAdjacentSurface(1),
    !isTearoffWindow,
  )
  useShortcut(
    'surface.previous',
    { ctrl: true, shift: true, key: 'Tab' },
    () => activateAdjacentSurface(-1),
    !isTearoffWindow,
  )

  // Panel + tab keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ── Tab shortcuts ──────────────────────────────────────────────
      const browserPanelState = useBrowserPanelStore.getState()
      handleBrowserPanelTabShortcut(e, {
        panelOpen: browserPanelState.open,
        ownerId: browserPanelState.activeOwnerId,
        onCloseLastTab: ownerId => useBrowserPanelStore.getState().setDockOpen(false, ownerId),
      })
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [])

  useEffect(() => {
    return (
      window.cradle?.ipc.on(BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL, (payload) => {
        const browserPanelState = useBrowserPanelStore.getState()
        handleBrowserPanelTabShortcutPayload(payload, {
          panelOpen: browserPanelState.open,
          ownerId: browserPanelState.activeOwnerId,
          onCloseLastTab: ownerId => useBrowserPanelStore.getState().setDockOpen(false, ownerId),
        })
      }) ?? (() => {})
    )
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
        void queryClient.invalidateQueries({
          queryKey: runtimeSessionStatusQueryKey(chatSessionId),
        })
      }
    })
  }, [queryClient])
}
