import type { ConnectionSettingsViewProps } from './connection-settings-view-contract'
import type { SettingsViewProps } from './settings-view-contract'

export const settingsFixture: SettingsViewProps = {
  appVersion: '0.1.0',
  kind: 'direct',
  connection: {
    hasServerToken: true,
    latencyMs: 18,
    serverUrl: 'http://192.168.1.20:21423',
    status: 'connected',
    uptimeSeconds: 176_520,
  },
  onCheckConnection: () => {},
  onCopyServer: async () => {},
  onDisconnect: () => {},
  onEditServer: () => {},
  onEditToken: () => {},
  onOpenUsage: () => {},
  onShareServer: async () => {},
}

export const fabricSettingsFixture: SettingsViewProps = {
  appVersion: '0.1.0',
  kind: 'fabric',
  connection: {
    fabricId: 'fabric_01JQ8W7ZJ3C57A2T5JYZ6MA1QK',
    nodes: [
      { displayName: 'Studio Mac', nodeId: 'node_studio', status: 'online' },
      { displayName: 'Build Mac', nodeId: 'node_build', status: 'offline' },
    ],
    relayUrl: 'https://fabric.cradle.sh',
    selectedNodeId: 'node_studio',
    status: 'connected',
  },
  onDisconnect: () => {},
  onOpenUsage: () => {},
  onRefreshNodes: () => {},
  onSelectNode: () => {},
}

export const connectionSettingsFixture: ConnectionSettingsViewProps = {
  onChangeValue: () => {},
  onSubmit: () => {},
  setting: 'server',
  value: 'http://192.168.1.20:21423',
}
