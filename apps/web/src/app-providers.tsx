import { domAnimation, LazyMotion } from 'motion/react'
import { useEffect } from 'react'

import { toastManager, ToastProvider } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'
import { createChatContextProvider } from '~/features/chat/context/chat-context'
import { installContextProviders } from '~/features/context/context-registry'
import { DirectoryPickerProvider } from '~/features/filesystem/directory-picker-provider'
import { createKanbanContextProvider } from '~/features/kanban/kanban-context'
import { createExplicitContextProvider } from '~/features/system-agent/explicit-context'
import { createSystemAgentContextProvider } from '~/features/system-agent/system-context-provider'
import { subscribeDesktopQuitGuardArmed, syncDesktopWindowControlsOverlay } from '~/lib/electron'
import { ShortcutProvider } from '~/lib/shortcut-provider'
import { useResolvedThemeMode } from '~/store/theme'
import { selectActiveThemeProfile, useThemeCustomizationStore } from '~/store/theme-customization'
import { applyThemeProfile } from '~/store/theme-customization-runtime'

export function AppEnvironmentProviders({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <ToastProvider>
        <DesktopQuitGuardToastBridge />
        <RendererContextRuntime />
        <TooltipProvider>
          <ShortcutProvider>
            <DirectoryPickerProvider>{children}</DirectoryPickerProvider>
          </ShortcutProvider>
        </TooltipProvider>
      </ToastProvider>
    </LazyMotion>
  )
}

function RendererContextRuntime() {
  useEffect(() => {
    return installContextProviders([
      createSystemAgentContextProvider(),
      createExplicitContextProvider(),
      createChatContextProvider(),
      createKanbanContextProvider(),
    ])
  }, [])

  return null
}

function DesktopQuitGuardToastBridge() {
  useEffect(() => {
    return subscribeDesktopQuitGuardArmed(() => {
      toastManager.add({
        type: 'info',
        title: 'Press Command+Q again to quit',
        description: 'Cradle will quit if you repeat the shortcut now.',
      })
    })
  }, [])

  return null
}

export function useThemeClass(): void {
  const resolvedMode = useResolvedThemeMode()
  const profile = useThemeCustomizationStore(state => selectActiveThemeProfile(state, resolvedMode))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark')
    const removeThemeProfile = applyThemeProfile(profile, resolvedMode)
    syncDesktopWindowControlsOverlay()
    const timeout = window.setTimeout(syncDesktopWindowControlsOverlay, 100)
    return () => {
      window.clearTimeout(timeout)
      removeThemeProfile()
    }
  }, [profile, resolvedMode])
}
