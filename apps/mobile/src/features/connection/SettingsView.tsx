import { LogOut, Server } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface SettingsViewProps {
  serverUrl: string
  onDisconnect: () => void
}

export function SettingsView({ serverUrl, onDisconnect }: SettingsViewProps) {
  const theme = useTheme()
  return (
    <Screen title="Connection" subtitle="This device is connected to your Cradle Server.">
      <View style={[styles.server, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Server color={theme.foreground} size={20} />
        <View style={styles.serverCopy}>
          <Text style={[styles.serverLabel, { color: theme.mutedForeground }]}>SERVER</Text>
          <Text numberOfLines={1} style={[styles.serverUrl, { color: theme.foreground }]}>{serverUrl}</Text>
        </View>
      </View>
      <Button icon={LogOut} label="Disconnect" onPress={onDisconnect} variant="destructive" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  server: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  serverCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  serverLabel: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 10,
  },
  serverUrl: {
    fontFamily: 'Geist_500Medium',
    fontSize: 15,
  },
})
