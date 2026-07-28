import { ArrowRight, Link2, LockKeyhole } from 'lucide-react-native'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface OnboardingViewProps {
  defaultUrl?: string
  error?: string | null
  isConnecting?: boolean
  onConnect: (url: string, token: string) => void
}

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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
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
            <Text style={[styles.title, { color: theme.foreground }]}>Take your work with you.</Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>
              Connect this device to a Cradle Server to follow active work and continue any conversation.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.foreground }]}>Server URL</Text>
              <View style={[styles.inputFrame, { borderColor: theme.input, backgroundColor: theme.card }]}>
                <Link2 color={theme.mutedForeground} size={18} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setUrl}
                  placeholder="http://192.168.1.20:21423"
                  placeholderTextColor={theme.mutedForeground}
                  returnKeyType="next"
                  style={[styles.input, { color: theme.foreground }]}
                  value={url}
                />
              </View>
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.foreground }]}>Access token</Text>
                <Text style={[styles.optional, { color: theme.mutedForeground }]}>Optional</Text>
              </View>
              <View style={[styles.inputFrame, { borderColor: theme.input, backgroundColor: theme.card }]}>
                <LockKeyhole color={theme.mutedForeground} size={18} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setToken}
                  placeholder="Required for protected servers"
                  placeholderTextColor={theme.mutedForeground}
                  secureTextEntry
                  style={[styles.input, { color: theme.foreground }]}
                  value={token}
                />
              </View>
            </View>

            {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}

            <Button
              disabled={!url.trim()}
              icon={ArrowRight}
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
    fontFamily: 'Geist_400Regular',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 360,
  },
  error: {
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  field: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  input: {
    flex: 1,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
    height: 48,
    paddingVertical: 0,
  },
  inputFrame: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    height: 50,
    paddingHorizontal: 14,
  },
  keyboard: {
    flex: 1,
  },
  label: {
    fontFamily: 'Geist_600SemiBold',
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
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },
  safeArea: {
    flex: 1,
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 34,
    lineHeight: 40,
  },
  wordmark: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 20,
  },
})
