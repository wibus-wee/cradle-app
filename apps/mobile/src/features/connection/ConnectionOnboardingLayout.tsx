import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface ConnectionOnboardingLayoutProps {
  children: ReactNode
  description: string
  icon: LucideIcon
  testID?: string
  title: string
}

export function ConnectionOnboardingLayout({
  children,
  description,
  icon: Icon,
  testID,
  title,
}: ConnectionOnboardingLayoutProps) {
  const theme = useTheme()
  const { height, width } = useWindowDimensions()
  const isWideLayout = width >= 900 && height >= 600

  return (
    <SafeAreaView
      edges={isWideLayout ? ['top', 'left', 'right'] : undefined}
      style={[styles.safeArea, { backgroundColor: theme.surface }]}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <ScrollView
          contentContainerStyle={[styles.content, isWideLayout && styles.contentWide]}
          keyboardShouldPersistTaps="handled"
        >
          {isWideLayout
            ? (
                <View style={styles.wideShell} testID={testID}>
                  <View style={[styles.infoPane, { backgroundColor: theme.primary }]}>
                    <Brand inverted />
                    <View style={styles.wideHeader}>
                      <View style={[styles.wideIcon, { backgroundColor: theme.primaryForeground }]}>
                        <Icon color={theme.primary} size={24} strokeWidth={1.9} />
                      </View>
                      <Text style={[styles.wideTitle, { color: theme.primaryForeground }]}>{title}</Text>
                      <Text style={[styles.wideDescription, { color: theme.primaryForeground }]}>{description}</Text>
                    </View>
                  </View>
                  <View style={[styles.actionPane, { backgroundColor: theme.surface }]}>
                    <View style={styles.wideActions}>{children}</View>
                  </View>
                </View>
              )
            : (
                <View style={styles.narrowShell} testID={testID}>
                  <Brand />
                  <View style={styles.narrowHeader}>
                    <View style={[styles.narrowIcon, { backgroundColor: theme.muted }]}>
                      <Icon color={theme.foreground} size={20} />
                    </View>
                    <Text style={[styles.narrowTitle, { color: theme.foreground }]}>{title}</Text>
                    <Text style={[styles.narrowDescription, { color: theme.mutedForeground }]}>{description}</Text>
                  </View>
                  <View style={styles.narrowActions}>{children}</View>
                </View>
              )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Brand({ inverted = false }: { inverted?: boolean }) {
  const theme = useTheme()
  const backgroundColor = inverted ? theme.primaryForeground : theme.primary
  const foregroundColor = inverted ? theme.primary : theme.primaryForeground
  const textColor = inverted ? theme.primaryForeground : theme.foreground

  return (
    <View style={styles.brand}>
      <View style={[styles.mark, { backgroundColor }]}>
        <View style={[styles.markInner, { backgroundColor: foregroundColor }]} />
      </View>
      <Text style={[styles.wordmark, { color: textColor }]}>Cradle</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  actionPane: {
    alignItems: 'center',
    flex: 7,
    justifyContent: 'center',
    minWidth: 0,
    padding: spacing.xxl,
  },
  brand: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  content: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  contentWide: { alignItems: 'stretch', padding: 0 },
  infoPane: {
    flex: 5,
    minWidth: 0,
    padding: spacing.xxl,
  },
  keyboard: { flex: 1 },
  mark: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
    width: 32,
  },
  markInner: { borderRadius: 2, height: 10, width: 10 },
  narrowActions: { gap: spacing.lg, marginTop: spacing.lg },
  narrowDescription: { fontSize: 13, lineHeight: 20, maxWidth: 360 },
  narrowHeader: { gap: spacing.sm, marginTop: 40 },
  narrowIcon: { alignItems: 'center', borderRadius: 8, height: 40, justifyContent: 'center', marginBottom: spacing.sm, width: 40 },
  narrowShell: { maxWidth: 520, width: '100%' },
  narrowTitle: { fontSize: 24, lineHeight: 30 },
  safeArea: { flex: 1 },
  wideActions: { gap: spacing.lg, maxWidth: 480, width: '100%' },
  wideDescription: { fontSize: 15, lineHeight: 23, maxWidth: 320, opacity: 0.64 },
  wideHeader: { flex: 1, gap: spacing.md, justifyContent: 'center' },
  wideIcon: { alignItems: 'center', borderRadius: 10, height: 48, justifyContent: 'center', marginBottom: spacing.sm, width: 48 },
  wideShell: { flexDirection: 'row', flexGrow: 1, minHeight: 600 },
  wideTitle: { fontSize: 32, lineHeight: 39 },
  wordmark: { fontSize: 20 },
})
