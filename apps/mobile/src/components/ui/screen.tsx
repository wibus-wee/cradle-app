import type { PropsWithChildren, ReactNode } from 'react'
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useKeyboardOffset } from '@/hooks/use-keyboard-offset'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface ScreenProps extends PropsWithChildren {
  avoidKeyboard?: boolean
  title?: string
  subtitle?: string
  action?: ReactNode
  leading?: ReactNode
  footer?: ReactNode
  nativeHeader?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  onPressBackground?: () => void
  scroll?: boolean
  insetTop?: boolean
}

export function Screen({
  avoidKeyboard = false,
  title,
  subtitle,
  action,
  leading,
  footer,
  children,
  nativeHeader = false,
  refreshing = false,
  onRefresh,
  onPressBackground,
  scroll = true,
  insetTop = true,
}: ScreenProps) {
  const theme = useTheme()
  const keyboardOffset = useKeyboardOffset(avoidKeyboard)
  const usesNativeHeader = nativeHeader && Platform.OS !== 'web'
  const content = (
    <>
      {!usesNativeHeader && (title || action) && (
        <View style={styles.header}>
          {insetTop && (
            <View style={styles.toolbar}>
              {leading}
              {action}
            </View>
          )}
          <View style={styles.titleRow}>
            <View style={styles.headerText}>
              {title && <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>}
              {subtitle && (
                <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>{subtitle}</Text>
              )}
            </View>
            {!insetTop && action}
          </View>
        </View>
      )}
      {usesNativeHeader && subtitle && (
        <Text style={[styles.nativeSubtitle, { color: theme.mutedForeground }]}>{subtitle}</Text>
      )}
      {children}
    </>
  )
  const dismissibleContent = onPressBackground
    ? (
        <Pressable
          accessible={false}
          onPress={onPressBackground}
          style={styles.backgroundPressable}
        >
          {content}
        </Pressable>
      )
    : content

  const page = (
    <>
      {scroll
        ? (
            <ScrollView
              contentContainerStyle={styles.content}
              contentInsetAdjustmentBehavior="automatic"
              keyboardDismissMode="none"
              keyboardShouldPersistTaps="handled"
              refreshControl={onRefresh
                ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.foreground} />
                : undefined}
              style={[styles.scroll, { backgroundColor: theme.surface }]}
            >
              {dismissibleContent}
            </ScrollView>
          )
        : <View style={[styles.content, styles.staticContent]}>{dismissibleContent}</View>}
      {footer && (
        <Animated.View
          style={[
            styles.footer,
            {
              transform: [{ translateY: keyboardOffset }],
            },
          ]}
        >
          {footer}
        </Animated.View>
      )}
    </>
  )

  return (
    <SafeAreaView
      collapsable={false}
      edges={insetTop && !usesNativeHeader ? ['top', 'bottom'] : ['bottom']}
      style={[styles.safeArea, { backgroundColor: theme.surface }]}
    >
      <View style={styles.page}>{page}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  backgroundPressable: {
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  footer: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    zIndex: 2,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: 'stretch',
    paddingBottom: 20,
    paddingTop: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  nativeSubtitle: {
    fontSize: 14,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  title: {

    fontSize: 22,
    lineHeight: 28,
  },
  subtitle: {

    fontSize: 14,
    lineHeight: 19,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  scroll: {
    flex: 1,
  },
  staticContent: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
})
