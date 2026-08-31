import { Link2, LockKeyhole } from 'lucide-react-native'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { InputGroup } from '@/components/ui/input-group'
import { NativeAction } from '@/components/ui/native-action'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { OnboardingViewProps } from './onboarding-view-contract'

export type { OnboardingViewProps } from './onboarding-view-contract'

export function OnboardingView({
  defaultUrl = '',
  error = null,
  isConnecting = false,
  onConnect,
}: OnboardingViewProps) {
  const theme = useTheme()
  const [url, setUrl] = useState(defaultUrl)
  const [token, setToken] = useState('')

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <View style={[styles.mark, { backgroundColor: theme.primary }]}>
              <View style={[styles.markInner, { backgroundColor: theme.primaryForeground }]} />
            </View>
            <Text style={[styles.wordmark, { color: theme.foreground }]}>Cradle</Text>
          </View>

          <View style={styles.copy}>
            <Text style={[styles.title, { color: theme.foreground }]}>Connect to Cradle</Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>
              Use the Server address shown in Cradle Desktop.
            </Text>
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

            <NativeAction
              disabled={!url.trim()}
              label="Connect to server"
              loading={isConnecting}
              onPress={() => onConnect(url, token)}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  copy: {
    gap: spacing.md,
    marginBottom: 36,
    marginTop: 48,
  },
  description: {

    fontSize: 13,
    lineHeight: 20,
    maxWidth: 360,
  },
  error: {

    fontSize: 13,
    lineHeight: 18,
  },
  field: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  keyboard: {
    flex: 1,
  },
  label: {

    fontSize: 13,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  mark: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
    width: 32,
  },
  markInner: {
    borderRadius: 2,
    height: 10,
    width: 10,
  },
  optional: {

    fontSize: 12,
  },
  safeArea: {
    flex: 1,
  },
  title: {

    fontSize: 24,
    lineHeight: 30,
  },
  wordmark: {

    fontSize: 20,
  },
})
