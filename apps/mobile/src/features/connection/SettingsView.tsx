import {
  ChartNoAxesColumn,
  ChevronRight,
  Copy,
  Link2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Share2,
  Wifi,
} from 'lucide-react-native'
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native'

import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { IconButton } from '@/components/ui/icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { StatusPill } from '@/components/ui/status-pill'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface SettingsViewProps {
  appVersion: string
  connectionStatus: 'checking' | 'connected' | 'unavailable'
  hasServerToken: boolean
  onCheckConnection: () => void
  onCopyServer: () => Promise<void>
  onDisconnect: () => void
  onEditServer: () => void
  onEditToken: () => void
  onNavigate: (section: AppSection) => void
  onOpenUsage: () => void
  onShareServer: () => Promise<void>
  serverUrl: string
}

export function SettingsView({
  appVersion,
  connectionStatus,
  hasServerToken,
  onCheckConnection,
  onCopyServer,
  onDisconnect,
  onEditServer,
  onEditToken,
  onNavigate,
  onOpenUsage,
  onShareServer,
  serverUrl,
}: SettingsViewProps) {
  const theme = useTheme()
  const disconnect = () => {
    Alert.alert('Disconnect from server?', 'The saved address and token will be removed from this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: onDisconnect, style: 'destructive', text: 'Disconnect' },
    ])
  }
  const copyServer = async () => {
    try {
      await onCopyServer()
      Alert.alert('Server address copied')
    }
    catch {
      Alert.alert('Could not copy server address')
    }
  }
  const shareServer = async () => {
    try {
      await onShareServer()
    }
    catch {
      Alert.alert('Could not share server address')
    }
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
            actions={(
              <View style={styles.connectionActions}>
                <StatusPill
                  label={connectionStatus}
                  tone={connectionStatus === 'connected'
                    ? 'success'
                    : connectionStatus === 'unavailable'
                      ? 'danger'
                      : 'neutral'}
                />
                {connectionStatus === 'checking'
                  ? <ActivityIndicator color={theme.mutedForeground} size="small" />
                  : (
                      <IconButton
                        accessibilityLabel="Check server connection"
                        icon={RefreshCw}
                        onPress={onCheckConnection}
                      />
                    )}
              </View>
            )}
            description={connectionStatus === 'connected'
              ? 'Server is responding'
              : connectionStatus === 'unavailable'
                ? 'Server could not be reached'
                : 'Contacting server'}
            media={<Wifi color={connectionStatus === 'connected' ? theme.success : theme.tertiaryForeground} size={19} />}
            title="Connection status"
          />
          <Item
            actions={(
              <View style={styles.serverActions}>
                <IconButton
                  accessibilityLabel="Copy server address"
                  icon={Copy}
                  onPress={() => void copyServer()}
                  stopPropagation
                />
                <IconButton
                  accessibilityLabel="Share server address"
                  icon={Share2}
                  onPress={() => void shareServer()}
                  stopPropagation
                />
                {disclosure}
              </View>
            )}
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
  connectionActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  page: {
    flex: 1,
  },
  section: {
    marginBottom: spacing.lg,
  },
  serverActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
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
