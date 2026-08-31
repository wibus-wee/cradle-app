import { useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { Redirect, router } from 'expo-router'

import { useFabric } from '@/features/fabric/fabric-context'

import { useConnection } from './connection-context'
import { SettingsView } from './SettingsView'

export function SettingsContainer() {
  const { connection, disconnect } = useConnection()
  const fabric = useFabric()
  const queryClient = useQueryClient()

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
        connection={{ kind: 'direct', hasServerToken: Boolean(connection.token), serverUrl: connection.url }}
        onDisconnect={disconnectCurrent}
        onEditServer={() => router.push('/connection/server')}
        onEditToken={() => router.push('/connection/token')}
        onNavigate={section => router.replace(`/(tabs)/${section}`)}
        onOpenUsage={() => router.push('/usage')}
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
      connection={{
        kind: 'fabric',
        fabricId: membership.fabricId,
        nodes: membership.directory.nodes.map(node => ({
          nodeId: node.nodeId,
          displayName: node.displayName,
          status: node.status,
        })),
        relayUrl: membership.relayUrl,
        selectedNodeId: membership.selectedNodeId,
        status: fabric.transportStatus,
      }}
      onDisconnect={disconnectCurrent}
      onNavigate={section => router.replace(`/(tabs)/${section}`)}
      onOpenUsage={() => router.push('/usage')}
      onRefreshNodes={() => void fabric.refreshDirectory().catch(() => {})}
      onSelectNode={nodeId => void fabric.selectNode(nodeId)}
    />
  )
}
