import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { Redirect, router } from 'expo-router'
import { Share } from 'react-native'

import type { GetHealthResponse } from '@/api-gen'
import { useFabric } from '@/features/fabric/fabric-context'
import { cradleRequest } from '@/lib/api'
import { useRouteIsActive } from '@/lib/app-lifecycle-context'

import { useConnection } from './connection-context'
import { SettingsView } from './SettingsView'

export function SettingsContainer() {
  const { connection, disconnect } = useConnection()
  const fabric = useFabric()
  const isRouteActive = useRouteIsActive()
  const queryClient = useQueryClient()
  const healthQuery = useQuery({
    enabled: connection?.kind === 'direct' && isRouteActive,
    queryKey: ['connection-health', connection?.resourceId],
    queryFn: async ({ signal }) => {
      if (!connection || connection.kind !== 'direct') {
        throw new Error('A direct server connection is required for health checks.')
      }
      const startedAt = performance.now()
      const health = await cradleRequest<GetHealthResponse>(connection, '/health', { signal })
      return {
        health,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      }
    },
  })

  if (!connection) {
    return <Redirect href="/" />
  }

  const appVersion = Constants.expoConfig?.version ?? '0.1.0'
  const disconnectCurrent = () => {
    queryClient.clear()
    void disconnect().then(() => router.replace('/'))
  }

  if (connection.kind === 'direct') {
    return (
      <SettingsView
        appVersion={appVersion}
        kind="direct"
        connection={{
          hasServerToken: Boolean(connection.token),
          latencyMs: healthQuery.data?.latencyMs,
          serverUrl: connection.url,
          status: healthQuery.isPending || healthQuery.isFetching
            ? 'checking'
            : healthQuery.isError
              ? 'unavailable'
              : 'connected',
          uptimeSeconds: healthQuery.data?.health.uptime,
        }}
        onCheckConnection={() => void healthQuery.refetch()}
        onCopyServer={async () => {
          await Clipboard.setStringAsync(connection.url)
        }}
        onDisconnect={disconnectCurrent}
        onEditServer={() => router.push('/connection/server')}
        onEditToken={() => router.push('/connection/token')}
        onOpenUsage={() => router.push('/usage')}
        onShareServer={async () => {
          await Share.share({
            message: connection.url,
            title: 'Cradle server address',
          })
        }}
      />
    )
  }

  const membership = fabric.membership
  if (!membership) {
    return <Redirect href="/" />
  }

  return (
    <SettingsView
      appVersion={appVersion}
      kind="fabric"
      connection={{
        controllerId: membership.controllerId,
        fabricId: membership.fabricId,
        nodes: membership.directory.nodes.map(node => ({
          displayName: node.displayName,
          nodeId: node.nodeId,
          status: node.status,
        })),
        relayUrl: membership.relayUrl,
        selectedNodeId: membership.selectedNodeId,
        status: fabric.transportStatus,
      }}
      onDisconnect={disconnectCurrent}
      onOpenUsage={() => router.push('/usage')}
      onRefreshNodes={() => void fabric.refreshDirectory().catch(() => {})}
      onSelectNode={nodeId => void fabric.selectNode(nodeId)}
    />
  )
}
