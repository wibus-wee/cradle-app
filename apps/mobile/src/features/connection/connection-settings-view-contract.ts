export type ConnectionSetting = 'server' | 'token'

export interface ConnectionSettingsViewProps {
  error?: string | null
  onChangeValue: (value: string) => void
  onSubmit: () => void
  setting: ConnectionSetting
  value: string
}
