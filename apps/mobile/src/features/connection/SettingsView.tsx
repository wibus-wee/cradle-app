import {
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  Copy,
  Link2,
  LockKeyhole,
  LogOut,
  Monitor,
  Network,
  RefreshCw,
  Share2,
  Wifi,
} from 'lucide-react-native'
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native'

import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { IconButton } from '@/components/ui/icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { StatusPill } from '@/components/ui/status-pill'
import type { FabricTransportStatus } from '@/lib/transport/fabric-http-transport'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { SettingsViewProps } from './settings-view-contract'

export type { SettingsViewProps } from './settings-view-contract'

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

export function SettingsView(props: SettingsViewProps) {
  const { appVersion, onDisconnect, onOpenUsage } = props
  const theme = useTheme()
  const disconnect = () => {
    const isFabric = props.kind === 'fabric'
    Alert.alert(isFabric ? 'Leave Fabric?' : 'Disconnect from server?', isFabric
      ? 'This Controller identity and its private keys will be removed from this device.'
      : 'The saved address and token will be removed from this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: onDisconnect, style: 'destructive', text: isFabric ? 'Leave' : 'Disconnect' },
    ])
  }
  const copyServer = async () => {
    if (props.kind !== 'direct') {
      return
    }
    try {
      await props.onCopyServer()
      Alert.alert('Server address copied')
    }
    catch {
      Alert.alert('Could not copy server address')
    }
  }
  const shareServer = async () => {
    if (props.kind !== 'direct') {
      return
    }
    try {
      await props.onShareServer()
    }
    catch {
      Alert.alert('Could not share server address')
    }
  }
  const disclosure = <ChevronRight color={theme.dimForeground} size={18} />

  return (
    <Screen
      leading={<CradleIconButton onPress={onOpenUsage} />}
      nativeHeader
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
          {props.kind === 'direct'
            ? (
                <>
                  <Item
                    actions={(
                      <View style={styles.connectionActions}>
                        <StatusPill
                          label={props.connection.status}
                          tone={props.connection.status === 'connected'
                            ? 'success'
                            : props.connection.status === 'unavailable'
                              ? 'danger'
                              : 'neutral'}
                        />
                        {props.connection.status === 'checking'
                          ? <ActivityIndicator color={theme.mutedForeground} size="small" />
                          : (
                              <IconButton
                                accessibilityLabel="Check server connection"
                                icon={RefreshCw}
                                onPress={props.onCheckConnection}
                              />
                            )}
                      </View>
                    )}
                    description={props.connection.status === 'connected'
                      ? 'Server is responding'
                      : props.connection.status === 'unavailable'
                        ? 'Server could not be reached'
                        : 'Contacting server'}
                    media={<Wifi color={props.connection.status === 'connected' ? theme.success : theme.tertiaryForeground} size={19} />}
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
                    description={props.connection.serverUrl}
                    media={<Link2 color={theme.tertiaryForeground} size={19} />}
                    onPress={props.onEditServer}
                    title="Server"
                  />
                  <Item
                    actions={disclosure}
                    description={props.connection.hasServerToken ? 'Configured' : 'Not configured'}
                    media={<LockKeyhole color={theme.tertiaryForeground} size={19} />}
                    onPress={props.onEditToken}
                    title="Authentication"
                  />
                </>
              )
            : (
                <>
                  <Item
                    actions={(
                      <StatusPill
                        label={TRANSPORT_STATUS_LABEL[props.connection.status]}
                        tone={TRANSPORT_STATUS_TONE[props.connection.status]}
                      />
                    )}
                    description={props.connection.relayUrl}
                    media={<Network color={theme.tertiaryForeground} size={19} />}
                    title="Fabric Relay"
                  />
                  <Item
                    description={props.connection.fabricId}
                    media={<LockKeyhole color={theme.tertiaryForeground} size={19} />}
                    title="End-to-end encrypted"
                  />
                </>
              )}
        </View>

        {props.kind === 'fabric' && (
          <View style={styles.section}>
            <SectionHeading title="Computers" />
            {props.connection.nodes.map(node => (
              <Item
                actions={node.nodeId === props.connection.selectedNodeId
                  ? <Check color={theme.foreground} size={19} />
                  : undefined}
                description={node.status === 'online' ? 'Online' : 'Offline'}
                key={node.nodeId}
                media={<Monitor color={theme.tertiaryForeground} size={19} />}
                onPress={() => props.onSelectNode(node.nodeId)}
                testID={`settings-node-${node.nodeId}`}
                title={node.displayName}
              />
            ))}
            <Item
              media={<RefreshCw color={theme.tertiaryForeground} size={19} />}
              onPress={props.onRefreshNodes}
              title="Refresh computers"
            />
          </View>
        )}

        <View style={styles.section}>
          <SectionHeading title="More" />
          <Item
            media={<LogOut color={theme.tertiaryForeground} size={19} />}
            onPress={disconnect}
            title={props.kind === 'fabric' ? 'Leave Fabric' : 'Disconnect'}
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
