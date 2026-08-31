import {
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  Link2,
  LockKeyhole,
  LogOut,
  Monitor,
  Network,
  RefreshCw,
} from 'lucide-react-native'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { StatusPill } from '@/components/ui/status-pill'
import type { FabricTransportStatus } from '@/lib/transport/fabric-http-transport'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface FabricSettingsNode {
  nodeId: string
  displayName: string
  status: 'online' | 'offline'
}

type SettingsConnection
  = | { kind: 'direct', serverUrl: string, hasServerToken: boolean }
    | {
      kind: 'fabric'
      fabricId: string
      relayUrl: string
      selectedNodeId: string | null
      nodes: FabricSettingsNode[]
      status: FabricTransportStatus
    }

const TRANSPORT_STATUS_LABEL: Record<FabricTransportStatus, string> = {
  'access-denied': 'Refreshing access',
  'connected': 'Connected',
  'connecting': 'Connecting',
  'idle': 'On demand',
  'offline': 'Offline',
  'suspended': 'Suspended',
}

const TRANSPORT_STATUS_TONE: Record<FabricTransportStatus, 'neutral' | 'success' | 'warning'> = {
  'access-denied': 'warning',
  'connected': 'success',
  'connecting': 'neutral',
  'idle': 'neutral',
  'offline': 'warning',
  'suspended': 'neutral',
}

export interface SettingsViewProps {
  appVersion: string
  connection: SettingsConnection
  onDisconnect: () => void
  onEditServer?: () => void
  onEditToken?: () => void
  onNavigate: (section: AppSection) => void
  onOpenUsage: () => void
  onRefreshNodes?: () => void
  onSelectNode?: (nodeId: string) => void
}

export function SettingsView({
  appVersion,
  connection,
  onDisconnect,
  onEditServer,
  onEditToken,
  onNavigate,
  onOpenUsage,
  onRefreshNodes,
  onSelectNode,
}: SettingsViewProps) {
  const theme = useTheme()
  const disconnect = () => {
    const isFabric = connection.kind === 'fabric'
    Alert.alert(isFabric ? 'Leave Fabric?' : 'Disconnect from server?', isFabric
      ? 'This Controller identity and its private keys will be removed from this device.'
      : 'The saved address and token will be removed from this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: onDisconnect, style: 'destructive', text: isFabric ? 'Leave' : 'Disconnect' },
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
          {connection.kind === 'direct'
            ? (
                <>
                  <Item
                    actions={disclosure}
                    description={connection.serverUrl}
                    media={<Link2 color={theme.tertiaryForeground} size={19} />}
                    onPress={onEditServer}
                    title="Development server"
                  />
                  <Item
                    actions={disclosure}
                    description={connection.hasServerToken ? 'Configured' : 'Not configured'}
                    media={<LockKeyhole color={theme.tertiaryForeground} size={19} />}
                    onPress={onEditToken}
                    title="Authentication"
                  />
                </>
              )
            : (
                <>
                  <Item
                    actions={(
                      <StatusPill
                        label={TRANSPORT_STATUS_LABEL[connection.status]}
                        tone={TRANSPORT_STATUS_TONE[connection.status]}
                      />
                    )}
                    description={connection.relayUrl}
                    media={<Network color={theme.tertiaryForeground} size={19} />}
                    title="Fabric Relay"
                  />
                  <Item
                    description={connection.fabricId}
                    media={<LockKeyhole color={theme.tertiaryForeground} size={19} />}
                    title="End-to-end encrypted"
                  />
                </>
              )}
        </View>

        {connection.kind === 'fabric' && (
          <View style={styles.section}>
            <SectionHeading title="Computers" />
            {connection.nodes.map(node => (
              <Item
                actions={node.nodeId === connection.selectedNodeId
                  ? <Check color={theme.foreground} size={19} />
                  : undefined}
                description={node.status === 'online' ? 'Online' : 'Offline'}
                key={node.nodeId}
                media={<Monitor color={theme.tertiaryForeground} size={19} />}
                onPress={() => onSelectNode?.(node.nodeId)}
                testID={`settings-node-${node.nodeId}`}
                title={node.displayName}
              />
            ))}
            <Item
              media={<RefreshCw color={theme.tertiaryForeground} size={19} />}
              onPress={onRefreshNodes}
              title="Refresh computers"
            />
          </View>
        )}

        <View style={styles.section}>
          <SectionHeading title="More" />
          <Item
            media={<LogOut color={theme.tertiaryForeground} size={19} />}
            onPress={disconnect}
            title={connection.kind === 'fabric' ? 'Leave Fabric' : 'Disconnect'}
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
