import type { ConnectionSettingsViewProps } from './connection-settings-view-contract'
import type { SettingsViewProps } from './settings-view-contract'

export const settingsFixture: SettingsViewProps = {
  appVersion: '0.1.0',
  connectionStatus: 'connected',
  hasServerToken: true,
  onCheckConnection: () => {},
  onCopyServer: async () => {},
  onDisconnect: () => {},
  onEditServer: () => {},
  onEditToken: () => {},
  onOpenUsage: () => {},
  onShareServer: async () => {},
  serverLatencyMs: 18,
  serverUptimeSeconds: 176_520,
  serverUrl: 'http://192.168.1.20:21423',
}

export const connectionSettingsFixture: ConnectionSettingsViewProps = {
  onChangeValue: () => {},
  onSubmit: () => {},
  setting: 'server',
  value: 'http://192.168.1.20:21423',
}
