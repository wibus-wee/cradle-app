import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'

import { useConnection } from './connection-context'
import { SettingsView } from './SettingsView'

export function SettingsContainer() {
  const { connection, disconnect } = useConnection()
  const queryClient = useQueryClient()
  if (!connection) {
    router.replace('/')
    return null
  }

  return (
    <SettingsView
      onDisconnect={() => {
        queryClient.clear()
        void disconnect().then(() => router.replace('/'))
      }}
      serverUrl={connection.url}
    />
  )
}
