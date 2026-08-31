import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { Redirect, router } from 'expo-router'
import { Share } from 'react-native'

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
    queryFn: async ({ signal }) => {
      const startedAt = performance.now()
      const health = await cradleRequest<GetHealthResponse>(connection!, '/health', { signal })
      return {
        health,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      }
    },
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
      onCopyServer={async () => {
        await Clipboard.setStringAsync(connection.url)
      }}
      onDisconnect={() => {
        queryClient.clear()
        void disconnect().then(() => router.replace('/'))
      }}
      onEditServer={() => router.push('/connection/server')}
      onEditToken={() => router.push('/connection/token')}
      onOpenUsage={() => router.push('/usage')}
      onShareServer={async () => {
        await Share.share({
          message: connection.url,
          title: 'Cradle server address',
        })
      }}
      serverLatencyMs={healthQuery.data?.latencyMs}
      serverUptimeSeconds={healthQuery.data?.health.uptime}
      serverUrl={connection.url}
    />
  )
}
