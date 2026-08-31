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

import type { SettingsViewProps } from './settings-view-contract'

export type { SettingsViewProps } from './settings-view-contract'

const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const fullWidthRow = frame({ maxWidth: Infinity, alignment: 'leading' })
const plainButton = buttonStyle('plain')

const statusCopy = {
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

export function SettingsView({
  appVersion,
  connectionStatus,
  hasServerToken,
  onCheckConnection,
  onCopyServer,
  onDisconnect,
  onEditServer,
  onEditToken,
  onOpenUsage,
  onShareServer,
  serverLatencyMs = null,
  serverUptimeSeconds = null,
  serverUrl,
}: SettingsViewProps) {
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
    Alert.alert('Disconnect from server?', 'The saved address and token will be removed from this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: onDisconnect, style: 'destructive', text: 'Disconnect' },
    ])
  }
  const copyServer = async () => {
    try {
      await onCopyServer()
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
    try {
      await onShareServer()
    }
    catch {
      Alert.alert('Could not share server address')
    }
  }
  const status = statusCopy[connectionStatus]
  const uptimeLabel = serverUptimeSeconds === null
    ? null
    : serverUptimeSeconds < 60
      ? `${serverUptimeSeconds}s`
      : serverUptimeSeconds < 3_600
        ? `${Math.floor(serverUptimeSeconds / 60)}m`
        : serverUptimeSeconds < 86_400
          ? `${Math.floor(serverUptimeSeconds / 3_600)}h ${Math.floor(serverUptimeSeconds % 3_600 / 60)}m`
          : `${Math.floor(serverUptimeSeconds / 86_400)}d ${Math.floor(serverUptimeSeconds % 86_400 / 3_600)}h`
  const statusDescription = connectionStatus === 'connected' && serverLatencyMs !== null
    ? `${status.description} · ${serverLatencyMs} ms`
    : status.description

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[listStyle('insetGrouped')]}>
        <Section title="Activity">
          <Button modifiers={[plainButton]} onPress={onOpenUsage}>
            <HStack modifiers={[fullWidthRow]} spacing={12}>
              <Image color="secondary" size={18} systemName="chart.bar.xaxis" />
              <Text>Usage</Text>
              <Spacer />
              <Image color="secondary" size={14} systemName="chevron.forward" />
            </HStack>
          </Button>
        </Section>

        <Section
          footer={(
            <Text>
              {connectionStatus === 'checking'
                ? 'Checking the server now.'
                : uptimeLabel
                  ? `Server uptime ${uptimeLabel}. Tap the status row to check again.`
                  : 'Tap the status row to check again.'}
            </Text>
          )}
          title="Connection"
        >
          <Button modifiers={[plainButton]} onPress={onCheckConnection}>
            <HStack modifiers={[fullWidthRow]} spacing={12}>
              <Image
                color={connectionStatus === 'connected'
                  ? 'green'
                  : connectionStatus === 'unavailable'
                    ? 'red'
                    : 'secondary'}
                size={18}
                systemName="wifi"
              />
              <VStack alignment="leading" spacing={2}>
                <Text>Connection Status</Text>
                <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                  {statusDescription}
                </Text>
              </VStack>
              <Spacer />
              {connectionStatus === 'checking'
                ? <ProgressView />
                : (
                    <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                      {status.label}
                    </Text>
                  )}
            </HStack>
          </Button>

          <Button modifiers={[plainButton]} onPress={onEditServer}>
            <HStack modifiers={[fullWidthRow]} spacing={12}>
              <Image color="secondary" size={18} systemName="link" />
              <VStack alignment="leading" spacing={2}>
                <Text>Server</Text>
                <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                  {serverUrl}
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
          <Button label="Share Server Address" modifiers={[plainButton]} onPress={() => void shareServer()} systemImage="square.and.arrow.up" />

          <Button modifiers={[plainButton]} onPress={onEditToken}>
            <HStack modifiers={[fullWidthRow]} spacing={12}>
              <Image color="secondary" size={18} systemName="lock" />
              <Text>Authentication</Text>
              <Spacer />
              <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                {hasServerToken ? 'Configured' : 'Not Configured'}
              </Text>
              <Image color="secondary" size={14} systemName="chevron.forward" />
            </HStack>
          </Button>
        </Section>

        <Section
          footer={(
            <Text modifiers={[font({ textStyle: 'caption2' }), secondaryForeground]}>
              {`Cradle Mobile ${appVersion}`}
            </Text>
          )}
        >
          <Button
            label="Disconnect"
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
