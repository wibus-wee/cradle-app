import { useFocusEffect } from 'expo-router'
import { createContext, useCallback, useContext, useState } from 'react'
import { AppState } from 'react-native'

export const AppActiveContext = createContext(AppState.currentState === 'active')

export function useRouteIsActive(): boolean {
  const isAppActive = useContext(AppActiveContext)
  const [isRouteFocused, setIsRouteFocused] = useState(false)

  useFocusEffect(
    useCallback(() => {
      setIsRouteFocused(true)
      return () => setIsRouteFocused(false)
    }, []),
  )

  return isAppActive && isRouteFocused
}
