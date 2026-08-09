import type { QueryClient } from '@tanstack/react-query'
import { focusManager } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import type { AppStateStatus } from 'react-native'
import { AppState } from 'react-native'

import { AppActiveContext } from './app-lifecycle-context'

interface AppLifecycleProviderProps extends PropsWithChildren {
  queryClient: QueryClient
}

export function AppLifecycleProvider({ children, queryClient }: AppLifecycleProviderProps) {
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active')

  useEffect(() => {
    const updateAppState = (state: AppStateStatus) => {
      const active = state === 'active'
      setIsAppActive(active)
      focusManager.setFocused(active)
      if (!active) {
        void queryClient.cancelQueries()
      }
    }

    updateAppState(AppState.currentState)
    const subscription = AppState.addEventListener('change', updateAppState)
    return () => {
      subscription.remove()
      focusManager.setFocused(undefined)
    }
  }, [queryClient])

  return <AppActiveContext value={isAppActive}>{children}</AppActiveContext>
}
