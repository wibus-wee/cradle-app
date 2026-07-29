import {
  ChartNoAxesColumn,
  ChevronRight,
  Link2,
  LockKeyhole,
  LogOut,
} from 'lucide-react-native'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface SettingsViewProps {
  appVersion: string
  hasServerToken: boolean
  onDisconnect: () => void
  onEditServer: () => void
  onEditToken: () => void
  onNavigate: (section: AppSection) => void
  onOpenUsage: () => void
  serverUrl: string
}

export function SettingsView({
  appVersion,
  hasServerToken,
  onDisconnect,
  onEditServer,
  onEditToken,
  onNavigate,
  onOpenUsage,
  serverUrl,
}: SettingsViewProps) {
  const theme = useTheme()
  const disconnect = () => {
    Alert.alert('Disconnect from server?', 'The saved address and token will be removed from this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: onDisconnect, style: 'destructive', text: 'Disconnect' },
    ])
  }
  const disclosure = <ChevronRight color={theme.dimForeground} size={18} />

  return (
    <Screen
      action={<AppMenuButton current="settings" onSelect={onNavigate} />}
      leading={<CradleIconButton onPress={onOpenUsage} />}
      title="Settings"
    >
      <View style={styles.page}>
        <View style={styles.section}>
          <SectionHeading title="Activity" />
          <Item
            actions={disclosure}
            media={<ChartNoAxesColumn color={theme.tertiaryForeground} size={19} />}
            onPress={onOpenUsage}
            title="Usage"
          />
        </View>

        <View style={styles.section}>
          <SectionHeading title="Connection" />
          <Item
            actions={disclosure}
            description={serverUrl}
            media={<Link2 color={theme.tertiaryForeground} size={19} />}
            onPress={onEditServer}
            title="Server"
          />
          <Item
            actions={disclosure}
            description={hasServerToken ? 'Configured' : 'Not configured'}
            media={<LockKeyhole color={theme.tertiaryForeground} size={19} />}
            onPress={onEditToken}
            title="Authentication"
          />
        </View>

        <View style={styles.section}>
          <SectionHeading title="More" />
          <Item
            media={<LogOut color={theme.tertiaryForeground} size={19} />}
            onPress={disconnect}
            title="Disconnect"
          />
        </View>

        <Text style={[styles.version, { color: theme.mutedForeground }]}>
          {`CRADLE MOBILE ${appVersion}`}
        </Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  section: {
    marginBottom: spacing.lg,
  },
  version: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 10,
    marginTop: 'auto',
    paddingBottom: spacing.md,
    paddingTop: spacing.xxl,
    textAlign: 'center',
  },
})
