import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { PropsWithChildren } from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { ServerConnection } from '@/lib/api'

import { ConnectionContext } from './connection-context'

const SERVER_URL_KEY = 'cradle.mobile.server-url'
const SERVER_TOKEN_KEY = 'cradle.mobile.server-token'

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [connection, setConnection] = useState<ServerConnection | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    void Promise.all([
      AsyncStorage.getItem(SERVER_URL_KEY),
      SecureStore.getItemAsync(SERVER_TOKEN_KEY),
    ]).then(([url, token]) => {
      setConnection(url ? { url, token } : null)
      setIsRestoring(false)
    })
  }, [])

  const saveConnection = useCallback(async (next: ServerConnection) => {
    await AsyncStorage.setItem(SERVER_URL_KEY, next.url)
    if (next.token) {
      await SecureStore.setItemAsync(SERVER_TOKEN_KEY, next.token)
    }
    else {
      await SecureStore.deleteItemAsync(SERVER_TOKEN_KEY)
    }
    setConnection(next)
  }, [])

  const disconnect = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(SERVER_URL_KEY),
      SecureStore.deleteItemAsync(SERVER_TOKEN_KEY),
    ])
    setConnection(null)
  }, [])

  const value = useMemo(() => ({
    connection,
    isRestoring,
    saveConnection,
    disconnect,
  }), [connection, disconnect, isRestoring, saveConnection])

  return <ConnectionContext value={value}>{children}</ConnectionContext>
}
