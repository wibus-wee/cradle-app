import { fabricPublicKeyFingerprint } from '@cradle/fabric-protocol'
import { Clock3, Monitor, RefreshCw, Server, ShieldCheck, XCircle } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { StatusPill } from '@/components/ui/status-pill'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ConnectionOnboardingLayout } from './ConnectionOnboardingLayout'
import type { OnboardingViewProps } from './onboarding-view-contract'

export type { OnboardingViewProps } from './onboarding-view-contract'

export function OnboardingView({
  membership,
  pendingEnrollment,
  enrollmentStatus,
  membershipStatus,
  error = null,
  onJoinFabric,
  onCancelEnrollment,
  onRefreshDirectory,
  onSelectNode,
  onUseDirectServer,
  onLeaveFabric,
}: OnboardingViewProps) {
  const theme = useTheme()
  const [code, setCode] = useState('')
  const controllableNodes = membership?.directory.nodes.filter(node => node.scopes?.includes('control')) ?? []

  let description: string
  let icon: typeof ShieldCheck
  let testID: string
  let title: string
  let content
  if (pendingEnrollment) {
    const fingerprint = fabricPublicKeyFingerprint(pendingEnrollment.request.identityPubkey)
    const terminal = enrollmentStatus === 'rejected' || enrollmentStatus === 'expired'
    description = terminal
      ? enrollmentStatus === 'rejected' ? 'The Fabric owner declined this request.' : 'This request is no longer valid.'
      : 'Approve this Controller from Cradle Desktop.'
    icon = terminal ? XCircle : Clock3
    testID = 'fabric-enrollment-pending'
    title = terminal ? (enrollmentStatus === 'rejected' ? 'Request rejected' : 'Request expired') : 'Waiting for approval'
    content = (
      <>
        {!terminal && (
          <View style={styles.details}>
            <StatusPill label="Approval pending" tone="warning" />
            <Detail label="Controller" value={pendingEnrollment.request.displayName} />
            <Detail label="Identity" value={fingerprint} mono />
            <Detail label="Expires" value={new Date(pendingEnrollment.expiresAt).toLocaleString()} />
          </View>
        )}
        {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
        <Button
          icon={terminal ? RefreshCw : XCircle}
          label={terminal ? 'Start again' : 'Cancel request'}
          onPress={onCancelEnrollment}
          variant={terminal ? 'primary' : 'secondary'}
        />
      </>
    )
  }
  else if (membership) {
    const unavailable = membershipStatus === 'revoked' || membershipStatus === 'invalid'
    if (unavailable) {
      description = membershipStatus === 'revoked'
        ? 'This Controller no longer has Fabric access.'
        : 'The saved Fabric identity could not be verified.'
      icon = XCircle
      testID = 'fabric-membership-unavailable'
      title = membershipStatus === 'revoked' ? 'Access revoked' : 'Fabric unavailable'
      content = (
        <>
          {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
          <Button icon={RefreshCw} label="Retry" onPress={onRefreshDirectory} />
          <Button label="Leave Fabric" onPress={onLeaveFabric} variant="secondary" />
        </>
      )
    }
    else {
      description = 'Choose where Mobile should open workspaces and conversations.'
      icon = Monitor
      testID = 'fabric-node-picker'
      title = 'Choose a computer'
      content = (
        <>
          <View style={styles.nodeList}>
            {controllableNodes.map(node => (
              <Item
                key={node.nodeId}
                actions={<StatusPill label={node.status === 'online' ? 'Online' : 'Offline'} tone={node.status === 'online' ? 'success' : 'neutral'} />}
                description={`${node.platform} · ${node.version}`}
                media={<Monitor color={theme.tertiaryForeground} size={19} />}
                onPress={() => onSelectNode(node.nodeId)}
                testID={`fabric-node-${node.nodeId}`}
                title={node.displayName}
              />
            ))}
            {controllableNodes.length === 0 && (
              <Text style={[styles.empty, { color: theme.mutedForeground }]}>No controllable computers are currently granted.</Text>
            )}
          </View>
          {membershipStatus === 'offline' && <StatusPill label="Directory offline" tone="warning" />}
          {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
          <Button icon={RefreshCw} label="Refresh computers" onPress={onRefreshDirectory} variant="secondary" />
          <Button label="Leave Fabric" onPress={onLeaveFabric} variant="secondary" />
        </>
      )
    }
  }
  else {
    description = 'Paste the Fabric code from Cradle Desktop.'
    icon = ShieldCheck
    testID = 'fabric-onboarding'
    title = 'Join your Fabric'
    content = (
      <>
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.foreground }]}>Fabric code</Text>
          <InputGroup
            addon={<ShieldCheck color={theme.tertiaryForeground} size={16} />}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setCode}
            placeholder="Paste Fabric code"
            testID="fabric-code-input"
            value={code}
          />
        </View>
        {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
        <Button
          disabled={!code.trim()}
          icon={ShieldCheck}
          label="Request access"
          loading={enrollmentStatus === 'submitting'}
          onPress={() => onJoinFabric(code)}
          testID="fabric-request-access"
        />
        <Button icon={Server} label="Direct Server" onPress={onUseDirectServer} variant="secondary" />
      </>
    )
  }

  return (
    <ConnectionOnboardingLayout description={description} icon={icon} testID={testID} title={title}>
      {content}
    </ConnectionOnboardingLayout>
  )
}

function Detail({ label, value, mono = false }: { label: string, value: string, mono?: boolean }) {
  const theme = useTheme()
  return (
    <View style={[styles.detail, { borderBottomColor: theme.border }]}>
      <Text style={[styles.detailLabel, { color: theme.mutedForeground }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.detailValue, mono && styles.mono, { color: theme.foreground }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  detail: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 3, minHeight: 48, paddingVertical: spacing.sm },
  detailLabel: { fontSize: 11 },
  detailValue: { fontSize: 13 },
  details: { gap: spacing.xs },
  empty: { fontSize: 13, lineHeight: 19, paddingVertical: spacing.md },
  error: { fontSize: 13, lineHeight: 18 },
  field: { gap: spacing.sm },
  label: { fontSize: 13 },
  mono: { fontFamily: 'GeistMono_400Regular', fontSize: 12 },
  nodeList: { gap: 0 },
})
