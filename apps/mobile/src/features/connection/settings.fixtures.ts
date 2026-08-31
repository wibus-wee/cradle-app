import type { ConnectionSettingsViewProps } from './ConnectionSettingsView'
import type { SettingsViewProps } from './SettingsView'

export const settingsFixture: SettingsViewProps = {
  appVersion: '0.1.0',
  connection: {
    kind: 'fabric',
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
  onNavigate: () => {},
  onOpenUsage: () => {},
  onRefreshNodes: () => {},
  onSelectNode: () => {},
}

export const connectionSettingsFixture: ConnectionSettingsViewProps = {
  onChangeValue: () => {},
  setting: 'server',
  value: 'http://192.168.1.20:21423',
}
