import { useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { Redirect, router } from 'expo-router'

import { useConnection } from './connection-context'
import { SettingsView } from './SettingsView'

export function SettingsContainer() {
  const { connection, disconnect } = useConnection()
  const queryClient = useQueryClient()

  if (!connection) {
    return <Redirect href="/" />
  }

  return (
    <SettingsView
      appVersion={Constants.expoConfig?.version ?? '0.1.0'}
      hasServerToken={Boolean(connection.token)}
      onDisconnect={() => {
        queryClient.clear()
        void disconnect().then(() => router.replace('/'))
      }}
      onEditServer={() => router.push('/connection/server')}
      onEditToken={() => router.push('/connection/token')}
      onNavigate={section => router.replace(`/(tabs)/${section}`)}
      onOpenUsage={() => router.push('/usage')}
      serverUrl={connection.url}
    />
  )
}
