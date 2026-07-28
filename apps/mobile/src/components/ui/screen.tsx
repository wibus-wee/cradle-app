import type { PropsWithChildren, ReactNode } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface ScreenProps extends PropsWithChildren {
  title?: string
  subtitle?: string
  action?: ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  scroll?: boolean
}

export function Screen({
  title,
  subtitle,
  action,
  children,
  refreshing = false,
  onRefresh,
  scroll = true,
}: ScreenProps) {
  const theme = useTheme()
  const content = (
    <>
      {(title || action) && (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title && <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>}
            {subtitle && (
              <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>{subtitle}</Text>
            )}
          </View>
          {action}
        </View>
      )}
      {children}
    </>
  )

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {scroll
        ? (
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              refreshControl={onRefresh
                ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.foreground} />
                : undefined}
            >
              {content}
            </ScrollView>
          )
        : <View style={styles.content}>{content}</View>}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 28,
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
})
