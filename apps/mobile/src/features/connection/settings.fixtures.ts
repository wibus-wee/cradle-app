import type { ConnectionSettingsViewProps } from './ConnectionSettingsView'
import type { SettingsViewProps } from './SettingsView'

export const settingsFixture: SettingsViewProps = {
  appVersion: '0.1.0',
  hasServerToken: true,
  onDisconnect: () => {},
  onEditServer: () => {},
  onEditToken: () => {},
  onNavigate: () => {},
  onOpenUsage: () => {},
  serverUrl: 'http://192.168.1.20:21423',
}

export const connectionSettingsFixture: ConnectionSettingsViewProps = {
  onChangeValue: () => {},
  setting: 'server',
  value: 'http://192.168.1.20:21423',
}
