import { ArrowLeft, Link2, LockKeyhole } from 'lucide-react-native'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { NativeAction } from '@/components/ui/native-action'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.content}>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: theme.foreground }]}>Direct Server</Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>Development connection</Text>
          </View>
          <View style={styles.form}>
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
            <NativeAction disabled={!url.trim()} label="Connect to Server" loading={isConnecting} onPress={() => onConnect(url, token)} />
            <Button icon={ArrowLeft} label="Back to Fabric" onPress={onBack} variant="secondary" />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  copy: { gap: spacing.sm, marginBottom: 36 },
  description: { fontFamily: 'GeistMono_400Regular', fontSize: 11, textTransform: 'uppercase' },
  error: { fontSize: 13, lineHeight: 18 },
  field: { gap: spacing.sm },
  form: { gap: spacing.lg },
  keyboard: { flex: 1 },
  label: { fontSize: 13 },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  optional: { fontSize: 12 },
  safeArea: { flex: 1 },
  title: { fontSize: 24, lineHeight: 30 },
})
