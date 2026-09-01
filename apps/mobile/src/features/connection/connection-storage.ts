import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

import type { DirectServerConfig } from '@/lib/api'

const SERVER_URL_KEY = 'cradle.mobile.server-url'
const SERVER_TOKEN_KEY = 'cradle.mobile.server-token'

async function readToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(SERVER_TOKEN_KEY)
  }
  const secureStore = await import('expo-secure-store')
  return secureStore.getItemAsync(SERVER_TOKEN_KEY)
}

async function writeToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (token) {
      await AsyncStorage.setItem(SERVER_TOKEN_KEY, token)
    }
    else {
      await AsyncStorage.removeItem(SERVER_TOKEN_KEY)
    }
    return
  }

  const secureStore = await import('expo-secure-store')
  if (token) {
    await secureStore.setItemAsync(SERVER_TOKEN_KEY, token)
  }
  else {
    await secureStore.deleteItemAsync(SERVER_TOKEN_KEY)
  }
}

export async function loadStoredConnection(): Promise<DirectServerConfig | null> {
  const [url, token] = await Promise.all([
    AsyncStorage.getItem(SERVER_URL_KEY),
    readToken(),
  ])
  return url ? { url, token } : null
}

export async function persistConnection(connection: DirectServerConfig): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(SERVER_URL_KEY, connection.url),
    writeToken(connection.token),
  ])
}

export async function clearStoredConnection(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(SERVER_URL_KEY),
    writeToken(null),
  ])
}
