import { Link2, LockKeyhole, LogOut, Save } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface SettingsViewProps {
  error?: string | null
  isSaving?: boolean
  serverToken: string
  serverUrl: string
  onDisconnect: () => void
  onSave: (url: string, token: string) => void
}

export function SettingsView({
  error = null,
  isSaving = false,
  serverToken,
  serverUrl,
  onDisconnect,
  onSave,
}: SettingsViewProps) {
  const theme = useTheme()
  const [url, setUrl] = useState(serverUrl)
  const [token, setToken] = useState(serverToken)

  return (
    <Screen title="Connection" subtitle="Change which Cradle Server this device connects to.">
      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.foreground }]}>Server URL</Text>
          <View style={[styles.inputFrame, { borderColor: theme.input, backgroundColor: theme.card }]}>
            <Link2 color={theme.mutedForeground} size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setUrl}
              placeholder="http://192.168.1.20:21423"
              placeholderTextColor={theme.mutedForeground}
              style={[styles.input, { color: theme.foreground }]}
              value={url}
            />
          </View>
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: theme.foreground }]}>Access token</Text>
            <Text style={[styles.optional, { color: theme.mutedForeground }]}>Optional</Text>
          </View>
          <View style={[styles.inputFrame, { borderColor: theme.input, backgroundColor: theme.card }]}>
            <LockKeyhole color={theme.mutedForeground} size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setToken}
              placeholder="Required for protected servers"
              placeholderTextColor={theme.mutedForeground}
              secureTextEntry
              style={[styles.input, { color: theme.foreground }]}
              value={token}
            />
          </View>
        </View>

        {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}

        <Button
          disabled={!url.trim()}
          icon={Save}
          label="Save connection"
          loading={isSaving}
          onPress={() => onSave(url, token)}
        />
      </View>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      <Button icon={LogOut} label="Disconnect" onPress={onDisconnect} variant="destructive" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: spacing.xl,
    marginTop: spacing.xl,
  },
  error: {
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  field: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  input: {
    flex: 1,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
    height: 48,
    paddingVertical: 0,
  },
  inputFrame: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    height: 50,
    paddingHorizontal: 14,
  },
  label: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 13,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  optional: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },
})
