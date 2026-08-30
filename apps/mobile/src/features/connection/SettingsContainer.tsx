import { useQuery, useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { Redirect, router } from 'expo-router'

import type { GetHealthResponse } from '@/api-gen'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'

import { useConnection } from './connection-context'
import { SettingsView } from './SettingsView'

export function SettingsContainer() {
  const { connection, disconnect } = useConnection()
  const isRouteActive = useRouteIsActive()
  const queryClient = useQueryClient()
  const healthQuery = useQuery({
    enabled: Boolean(connection) && isRouteActive,
    queryKey: ['connection-health', connection?.url],
    queryFn: ({ signal }) =>
      cradleRequest<GetHealthResponse>(connection!, '/health', { signal }),
  })

  if (!connection) {
    return <Redirect href="/" />
  }

  return (
    <SettingsView
      appVersion={Constants.expoConfig?.version ?? '0.1.0'}
      connectionStatus={healthQuery.isPending || healthQuery.isFetching
        ? 'checking'
        : healthQuery.isError
          ? 'unavailable'
          : 'connected'}
      hasServerToken={Boolean(connection.token)}
      onCheckConnection={() => void healthQuery.refetch()}
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
