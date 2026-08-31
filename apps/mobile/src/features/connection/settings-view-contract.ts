export interface SettingsViewProps {
  appVersion: string
  connectionStatus: 'checking' | 'connected' | 'unavailable'
  hasServerToken: boolean
  onCheckConnection: () => void
  onCopyServer: () => Promise<void>
  onDisconnect: () => void
  onEditServer: () => void
  onEditToken: () => void
  onOpenUsage: () => void
  onShareServer: () => Promise<void>
  serverLatencyMs?: number | null
  serverUptimeSeconds?: number | null
  serverUrl: string
}
