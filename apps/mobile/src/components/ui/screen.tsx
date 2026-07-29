import type { PropsWithChildren, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface ScreenProps extends PropsWithChildren {
  avoidKeyboard?: boolean
  title?: string
  subtitle?: string
  action?: ReactNode
  leading?: ReactNode
  footer?: ReactNode
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
  refreshing = false,
  onRefresh,
  onPressBackground,
  scroll = true,
  insetTop = true,
}: ScreenProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardOffset = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!avoidKeyboard) {
      keyboardOffset.setValue(0)
      return
    }

    const moveToKeyboard = (screenY: number, duration = 250) => {
      const overlap = Math.max(0, Dimensions.get('window').height - screenY - insets.bottom)
      Animated.timing(keyboardOffset, {
        duration,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: -overlap,
        useNativeDriver: true,
      }).start()
    }

    const moveToRest = (duration = 250) => {
      Animated.timing(keyboardOffset, {
        duration,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: 0,
        useNativeDriver: true,
      }).start()
    }

    const metrics = Keyboard.metrics()
    if (metrics) {
      moveToKeyboard(metrics.screenY, 0)
    }

    const changeEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const change = Keyboard.addListener(changeEvent, event => {
      moveToKeyboard(event.endCoordinates.screenY, event.duration)
    })
    const hide = Keyboard.addListener(hideEvent, event => {
      moveToRest(event.duration)
    })

    return () => {
      change.remove()
      hide.remove()
    }
  }, [avoidKeyboard, insets.bottom, keyboardOffset])
  const content = (
    <>
      {(title || action) && (
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
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              refreshControl={onRefresh
                ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.foreground} />
                : undefined}
              style={[styles.scroll, { backgroundColor: theme.surface }]}
            >
              {dismissibleContent}
            </ScrollView>
          )
        : <View style={styles.content}>{dismissibleContent}</View>}
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
    <SafeAreaView edges={insetTop ? ['top', 'bottom'] : ['bottom']} style={[styles.safeArea, { backgroundColor: theme.surface }]}>
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
  page: {
    flex: 1,
  },
})
