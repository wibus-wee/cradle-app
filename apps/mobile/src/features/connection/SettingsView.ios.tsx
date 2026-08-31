import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  Text,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  symbolEffect,
} from '@expo/ui/swift-ui/modifiers'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Alert } from 'react-native'

import type { FabricTransportStatus } from '@/lib/transport/fabric-http-transport'

import type { SettingsViewProps } from './settings-view-contract'

export type { SettingsViewProps } from './settings-view-contract'

const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const fullWidthRow = frame({ maxWidth: Infinity, alignment: 'leading' })
const plainButton = buttonStyle('plain')

const directStatusCopy = {
  checking: {
    description: 'Contacting server',
    label: 'Checking',
  },
  connected: {
    description: 'Server is responding',
    label: 'Connected',
  },
  unavailable: {
    description: 'Server could not be reached',
    label: 'Unavailable',
  },
} as const

const fabricStatusCopy: Record<FabricTransportStatus, string> = {
  'access-denied': 'Refreshing Access',
  'connected': 'Connected',
  'connecting': 'Connecting',
  'idle': 'On Demand',
  'offline': 'Offline',
  'suspended': 'Suspended',
}

export function SettingsView(props: SettingsViewProps) {
  const [copiedServer, setCopiedServer] = useState(false)
  const copySymbolTrigger = useNativeState(0)
  const copySequenceRef = useRef(0)
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current)
    }
  }, [])

  const disconnect = () => {
    const isFabric = props.kind === 'fabric'
    Alert.alert(
      isFabric ? 'Leave Fabric?' : 'Disconnect from server?',
      isFabric
        ? 'This Controller identity and its private keys will be removed from this device.'
        : 'The saved address and token will be removed from this device.',
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: props.onDisconnect,
          style: 'destructive',
          text: isFabric ? 'Leave' : 'Disconnect',
        },
      ],
    )
  }
  const copyServer = async () => {
    if (props.kind !== 'direct') {
      return
    }
    try {
      await props.onCopyServer()
      setCopiedServer(true)
      copySequenceRef.current += 1
      copySymbolTrigger.set(copySequenceRef.current)
      void Haptics.selectionAsync()
      AccessibilityInfo.announceForAccessibility('Server address copied')
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = setTimeout(setCopiedServer, 1_500, false)
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

  let directStatusDescription: string | null = null
  let directUptimeLabel: string | null = null
  if (props.kind === 'direct') {
    const { latencyMs = null, status, uptimeSeconds = null } = props.connection
    const statusCopy = directStatusCopy[status]
    directUptimeLabel = uptimeSeconds === null
      ? null
      : uptimeSeconds < 60
        ? `${uptimeSeconds}s`
        : uptimeSeconds < 3_600
          ? `${Math.floor(uptimeSeconds / 60)}m`
          : uptimeSeconds < 86_400
            ? `${Math.floor(uptimeSeconds / 3_600)}h ${Math.floor(uptimeSeconds % 3_600 / 60)}m`
            : `${Math.floor(uptimeSeconds / 86_400)}d ${Math.floor(uptimeSeconds % 86_400 / 3_600)}h`
    directStatusDescription = status === 'connected' && latencyMs !== null
      ? `${statusCopy.description} · ${latencyMs} ms`
      : statusCopy.description
  }

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[listStyle('insetGrouped')]}>
        <Section title="Activity">
          <Button modifiers={[plainButton]} onPress={props.onOpenUsage}>
            <HStack modifiers={[fullWidthRow]} spacing={12}>
              <Image color="secondary" size={18} systemName="chart.bar.xaxis" />
              <Text>Usage</Text>
              <Spacer />
              <Image color="secondary" size={14} systemName="chevron.forward" />
            </HStack>
          </Button>
        </Section>

        {props.kind === 'direct'
          ? (
              <Section
                footer={(
                  <Text>
                    {props.connection.status === 'checking'
                      ? 'Checking the server now.'
                      : directUptimeLabel
                        ? `Server uptime ${directUptimeLabel}. Tap the status row to check again.`
                        : 'Tap the status row to check again.'}
                  </Text>
                )}
                title="Connection"
              >
                <Button modifiers={[plainButton]} onPress={props.onCheckConnection}>
                  <HStack modifiers={[fullWidthRow]} spacing={12}>
                    <Image
                      color={props.connection.status === 'connected'
                        ? 'green'
                        : props.connection.status === 'unavailable'
                          ? 'red'
                          : 'secondary'}
                      size={18}
                      systemName="wifi"
                    />
                    <VStack alignment="leading" spacing={2}>
                      <Text>Connection Status</Text>
                      <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                        {directStatusDescription}
                      </Text>
                    </VStack>
                    <Spacer />
                    {props.connection.status === 'checking'
                      ? <ProgressView />
                      : (
                          <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                            {directStatusCopy[props.connection.status].label}
                          </Text>
                        )}
                  </HStack>
                </Button>

                <Button modifiers={[plainButton]} onPress={props.onEditServer}>
                  <HStack modifiers={[fullWidthRow]} spacing={12}>
                    <Image color="secondary" size={18} systemName="link" />
                    <VStack alignment="leading" spacing={2}>
                      <Text>Server</Text>
                      <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                        {props.connection.serverUrl}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Image color="secondary" size={14} systemName="chevron.forward" />
                  </HStack>
                </Button>

                <Button
                  modifiers={[
                    plainButton,
                    accessibilityLabel(copiedServer ? 'Server address copied' : 'Copy server address'),
                  ]}
                  onPress={() => void copyServer()}
                >
                  <HStack modifiers={[fullWidthRow]} spacing={12}>
                    <Image
                      color={copiedServer ? 'green' : 'secondary'}
                      modifiers={[
                        symbolEffect(
                          { direction: 'up', effect: 'bounce' },
                          { value: copySymbolTrigger },
                        ),
                      ]}
                      size={18}
                      systemName={copiedServer ? 'checkmark.circle.fill' : 'doc.on.doc'}
                    />
                    <Text modifiers={copiedServer ? [foregroundStyle('green')] : []}>
                      {copiedServer ? 'Server Address Copied' : 'Copy Server Address'}
                    </Text>
                    <Spacer />
                  </HStack>
                </Button>
                <Button
                  label="Share Server Address"
                  modifiers={[plainButton]}
                  onPress={() => void shareServer()}
                  systemImage="square.and.arrow.up"
                />

                <Button modifiers={[plainButton]} onPress={props.onEditToken}>
                  <HStack modifiers={[fullWidthRow]} spacing={12}>
                    <Image color="secondary" size={18} systemName="lock" />
                    <Text>Authentication</Text>
                    <Spacer />
                    <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                      {props.connection.hasServerToken ? 'Configured' : 'Not Configured'}
                    </Text>
                    <Image color="secondary" size={14} systemName="chevron.forward" />
                  </HStack>
                </Button>
              </Section>
            )
          : (
              <>
                <Section title="Connection">
                  <HStack modifiers={[fullWidthRow]} spacing={12}>
                    <Image color="secondary" size={18} systemName="network" />
                    <VStack alignment="leading" spacing={2}>
                      <Text>Fabric Relay</Text>
                      <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                        {props.connection.relayUrl}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                      {fabricStatusCopy[props.connection.status]}
                    </Text>
                  </HStack>
                  <HStack modifiers={[fullWidthRow]} spacing={12}>
                    <Image color="secondary" size={18} systemName="lock.shield" />
                    <VStack alignment="leading" spacing={2}>
                      <Text>End-to-End Encrypted</Text>
                      <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                        {props.connection.fabricId}
                      </Text>
                    </VStack>
                  </HStack>
                </Section>

                <Section title="Computers">
                  {props.connection.nodes.map(node => (
                    <Button
                      key={node.nodeId}
                      modifiers={[plainButton]}
                      onPress={() => props.onSelectNode(node.nodeId)}
                    >
                      <HStack modifiers={[fullWidthRow]} spacing={12}>
                        <Image color="secondary" size={18} systemName="desktopcomputer" />
                        <VStack alignment="leading" spacing={2}>
                          <Text>{node.displayName}</Text>
                          <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                            {node.status === 'online' ? 'Online' : 'Offline'}
                          </Text>
                        </VStack>
                        <Spacer />
                        {node.nodeId === props.connection.selectedNodeId && (
                          <Image color="blue" size={16} systemName="checkmark" />
                        )}
                      </HStack>
                    </Button>
                  ))}
                  <Button
                    label="Refresh Computers"
                    modifiers={[plainButton]}
                    onPress={props.onRefreshNodes}
                    systemImage="arrow.clockwise"
                  />
                </Section>
              </>
            )}

        <Section
          footer={(
            <Text modifiers={[font({ textStyle: 'caption2' }), secondaryForeground]}>
              {`Cradle Mobile ${props.appVersion}`}
            </Text>
          )}
        >
          <Button
            label={props.kind === 'fabric' ? 'Leave Fabric' : 'Disconnect'}
            modifiers={[plainButton]}
            onPress={disconnect}
            role="destructive"
            systemImage="rectangle.portrait.and.arrow.right"
          />
        </Section>
      </Form>
    </Host>
  )
}
