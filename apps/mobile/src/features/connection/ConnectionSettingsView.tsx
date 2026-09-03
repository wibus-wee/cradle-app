import { Link2, LockKeyhole } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'

import { InputGroup } from '@/components/ui/input-group'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { ConnectionSettingsViewProps } from './connection-settings-view-contract'

export type { ConnectionSetting, ConnectionSettingsViewProps } from './connection-settings-view-contract'

export function ConnectionSettingsView({
  error = null,
  onChangeValue,
  onSubmit,
  setting,
  value,
}: ConnectionSettingsViewProps) {
  const theme = useTheme()
  const isServer = setting === 'server'

  return (
    <Screen insetTop={false}>
      <View style={styles.page}>
        <SectionHeading title={isServer ? 'Server' : 'Authentication'} />
        <View style={styles.form}>
          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: theme.foreground }]}>
                {isServer ? 'Server URL' : 'Access token'}
              </Text>
              {!isServer && (
                <Text style={[styles.optional, { color: theme.mutedForeground }]}>Optional</Text>
              )}
            </View>
            <InputGroup
              addon={isServer
                ? <Link2 color={theme.tertiaryForeground} size={16} />
                : <LockKeyhole color={theme.tertiaryForeground} size={16} />}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType={isServer ? 'url' : 'default'}
              onChangeText={onChangeValue}
              onSubmitEditing={onSubmit}
              placeholder={isServer
                ? 'http://192.168.1.20:21423'
                : 'Required for protected servers'}
              secureTextEntry={!isServer}
              value={value}
            />
          </View>

          {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  error: {
    fontSize: 13,
    lineHeight: 18,
  },
  field: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  label: {
    fontSize: 13,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  optional: {
    fontSize: 12,
  },
  page: {
    paddingTop: spacing.sm,
  },
})
