import type { FabricTransportStatus } from '@/lib/transport/fabric-http-transport'

export interface FabricSettingsNode {
  displayName: string
  nodeId: string
  status: 'online' | 'offline'
}

interface CommonSettingsViewProps {
  appVersion: string
  onDisconnect: () => void
  onOpenUsage: () => void
}

export interface DirectSettingsViewProps extends CommonSettingsViewProps {
  kind: 'direct'
  connection: {
    hasServerToken: boolean
    latencyMs?: number | null
    serverUrl: string
    status: 'checking' | 'connected' | 'unavailable'
    uptimeSeconds?: number | null
  }
  onCheckConnection: () => void
  onCopyServer: () => Promise<void>
  onEditServer: () => void
  onEditToken: () => void
  onShareServer: () => Promise<void>
}

export interface FabricSettingsViewProps extends CommonSettingsViewProps {
  kind: 'fabric'
  connection: {
    fabricId: string
    nodes: FabricSettingsNode[]
    relayUrl: string
    selectedNodeId: string | null
    status: FabricTransportStatus
  }
  onRefreshNodes: () => void
  onSelectNode: (nodeId: string) => void
}

export type SettingsViewProps = DirectSettingsViewProps | FabricSettingsViewProps
