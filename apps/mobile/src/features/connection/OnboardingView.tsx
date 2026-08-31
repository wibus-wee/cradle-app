import { fabricPublicKeyFingerprint } from '@cradle/fabric-protocol'
import { Clock3, Monitor, RefreshCw, Server, ShieldCheck, XCircle } from 'lucide-react-native'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { NativeAction } from '@/components/ui/native-action'
import { StatusPill } from '@/components/ui/status-pill'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

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

  let content
  if (pendingEnrollment) {
    const fingerprint = fabricPublicKeyFingerprint(pendingEnrollment.request.identityPubkey)
    const terminal = enrollmentStatus === 'rejected' || enrollmentStatus === 'expired'
    content = (
      <View style={styles.flow} testID="fabric-enrollment-pending">
        <FlowHeader
          description={terminal
            ? enrollmentStatus === 'rejected' ? 'The Fabric owner declined this request.' : 'This request is no longer valid.'
            : 'Approve this Controller from Cradle Desktop.'}
          icon={terminal ? XCircle : Clock3}
          title={terminal ? (enrollmentStatus === 'rejected' ? 'Request rejected' : 'Request expired') : 'Waiting for approval'}
        />
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
      </View>
    )
  }
  else if (membership) {
    const unavailable = membershipStatus === 'revoked' || membershipStatus === 'invalid'
    content = unavailable
      ? (
          <View style={styles.flow} testID="fabric-membership-unavailable">
            <FlowHeader
              description={membershipStatus === 'revoked'
                ? 'This Controller no longer has Fabric access.'
                : 'The saved Fabric identity could not be verified.'}
              icon={XCircle}
              title={membershipStatus === 'revoked' ? 'Access revoked' : 'Fabric unavailable'}
            />
            {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
            <Button icon={RefreshCw} label="Retry" onPress={onRefreshDirectory} />
            <Button label="Leave Fabric" onPress={onLeaveFabric} variant="secondary" />
          </View>
        )
      : (
          <View style={styles.flow} testID="fabric-node-picker">
            <FlowHeader
              description="Choose where Mobile should open workspaces and conversations."
              icon={Monitor}
              title="Choose a computer"
            />
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
          </View>
        )
  }
  else {
    content = (
      <View style={styles.flow} testID="fabric-onboarding">
        <FlowHeader description="Paste the Fabric code from Cradle Desktop." icon={ShieldCheck} title="Join your Fabric" />
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
        <NativeAction
          disabled={!code.trim()}
          label="Request access"
          loading={enrollmentStatus === 'submitting'}
          onPress={() => onJoinFabric(code)}
          testID="fabric-request-access"
        />
        <Button icon={Server} label="Direct Server" onPress={onUseDirectServer} variant="secondary" />
      </View>
    )
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={[styles.mark, { backgroundColor: theme.primary }]}>
              <View style={[styles.markInner, { backgroundColor: theme.primaryForeground }]} />
            </View>
            <Text style={[styles.wordmark, { color: theme.foreground }]}>Cradle</Text>
          </View>
          {content}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function FlowHeader({ description, icon: Icon, title }: {
  description: string
  icon: typeof ShieldCheck
  title: string
}) {
  const theme = useTheme()
  return (
    <View style={styles.copy}>
      <View style={[styles.flowIcon, { backgroundColor: theme.muted }]}>
        <Icon color={theme.foreground} size={20} />
      </View>
      <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
      <Text style={[styles.description, { color: theme.mutedForeground }]}>{description}</Text>
    </View>
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
  brand: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  copy: { gap: spacing.sm },
  description: { fontSize: 13, lineHeight: 20, maxWidth: 360 },
  detail: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 3, minHeight: 48, paddingVertical: spacing.sm },
  detailLabel: { fontSize: 11 },
  detailValue: { fontSize: 13 },
  details: { gap: spacing.xs },
  empty: { fontSize: 13, lineHeight: 19, paddingVertical: spacing.md },
  error: { fontSize: 13, lineHeight: 18 },
  field: { gap: spacing.sm },
  flow: { gap: spacing.lg, marginTop: 40 },
  flowIcon: { alignItems: 'center', borderRadius: 8, height: 40, justifyContent: 'center', marginBottom: spacing.sm, width: 40 },
  keyboard: { flex: 1 },
  label: { fontSize: 13 },
  mark: { alignItems: 'center', borderRadius: 8, height: 32, justifyContent: 'center', transform: [{ rotate: '-4deg' }], width: 32 },
  markInner: { borderRadius: 2, height: 10, width: 10 },
  mono: { fontFamily: 'GeistMono_400Regular', fontSize: 12 },
  nodeList: { gap: 0 },
  safeArea: { flex: 1 },
  title: { fontSize: 24, lineHeight: 30 },
  wordmark: { fontSize: 20 },
})
