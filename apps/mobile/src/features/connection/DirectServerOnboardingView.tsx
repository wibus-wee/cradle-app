import { ArrowLeft, Link2, LockKeyhole } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ConnectionOnboardingLayout } from './ConnectionOnboardingLayout'

export interface DirectServerOnboardingViewProps {
  defaultUrl?: string
  error?: string | null
  isConnecting?: boolean
  onBack: () => void
  onConnect: (url: string, token: string) => void
}

export function DirectServerOnboardingView({
  defaultUrl = '',
  error = null,
  isConnecting = false,
  onBack,
  onConnect,
}: DirectServerOnboardingViewProps) {
  const theme = useTheme()
  const [url, setUrl] = useState(defaultUrl)
  const [token, setToken] = useState('')

  return (
    <ConnectionOnboardingLayout description="Development connection" icon={Link2} title="Direct Server">
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.foreground }]}>Server URL</Text>
        <InputGroup
          addon={<Link2 color={theme.tertiaryForeground} size={16} />}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setUrl}
          placeholder="http://192.168.1.20:21423"
          returnKeyType="next"
          value={url}
        />
      </View>
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: theme.foreground }]}>Access token</Text>
          <Text style={[styles.optional, { color: theme.mutedForeground }]}>Optional</Text>
        </View>
        <InputGroup
          addon={<LockKeyhole color={theme.tertiaryForeground} size={16} />}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setToken}
          placeholder="Required for protected servers"
          secureTextEntry
          value={token}
        />
      </View>
      {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
      <Button disabled={!url.trim()} icon={Link2} label="Connect to Server" loading={isConnecting} onPress={() => onConnect(url, token)} />
      <Button icon={ArrowLeft} label="Back to Fabric" onPress={onBack} variant="secondary" />
    </ConnectionOnboardingLayout>
  )
}

const styles = StyleSheet.create({
  error: { fontSize: 13, lineHeight: 18 },
  field: { gap: spacing.sm },
  label: { fontSize: 13 },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  optional: { fontSize: 12 },
})
