import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { WorkspacePickerSheetProps } from './workspace-picker-sheet-contract'
import { WorkspacePickerContent } from './WorkspacePickerContent'

export type { WorkspacePickerSheetProps } from './workspace-picker-sheet-contract'

const closedOffset = 640

export function WorkspacePickerSheet({
  onClose,
  onDismissed,
  onSelect,
  selectedWorkspaceId,
  visible,
  workspaces,
}: WorkspacePickerSheetProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const translateY = useRef(new Animated.Value(closedOffset)).current
  const backdropOpacity = useRef(new Animated.Value(0)).current
  const mountedRef = useRef(false)
  const onDismissedRef = useRef(onDismissed)
  const [mounted, setMounted] = useState(false)

  onDismissedRef.current = onDismissed

  const spring = useCallback((value: number) => Animated.spring(translateY, {
    damping: 40,
    mass: 1,
    overshootClamping: true,
    stiffness: 600,
    toValue: value,
    useNativeDriver: true,
  }), [translateY])
  const fade = useCallback((value: number) => Animated.spring(backdropOpacity, {
    damping: 40,
    mass: 1,
    overshootClamping: true,
    stiffness: 600,
    toValue: value,
    useNativeDriver: true,
  }), [backdropOpacity])

  useEffect(() => {
    if (visible) {
      mountedRef.current = true
      setMounted(true)
      translateY.setValue(closedOffset)
      backdropOpacity.setValue(0)
      const frame = requestAnimationFrame(() => {
        Animated.parallel([spring(0), fade(1)]).start()
      })
      return () => cancelAnimationFrame(frame)
    }

    if (!mountedRef.current) { return }
    Animated.parallel([spring(closedOffset), fade(0)]).start(({ finished }) => {
      if (!finished) { return }
      mountedRef.current = false
      setMounted(false)
      onDismissedRef.current?.()
    })
  }, [backdropOpacity, fade, spring, translateY, visible])

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => {
      const offset = Math.max(0, gesture.dy)
      translateY.setValue(offset)
      backdropOpacity.setValue(Math.max(0, 1 - offset / 320))
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 88 || gesture.vy > 0.85) {
        onClose()
        return
      }
      Animated.parallel([spring(0), fade(1)]).start()
    },
    onPanResponderTerminate: () => {
      Animated.parallel([spring(0), fade(1)]).start()
    },
  }), [backdropOpacity, fade, onClose, spring, translateY])

  if (!mounted) { return null }

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.modal}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.backdrop,
            {
              backgroundColor: theme.overlay,
              opacity: backdropOpacity,
            },
          ]}
        />
        <Pressable
          accessibilityLabel="Close repository picker"
          accessibilityRole="button"
          onPress={() => {
            Keyboard.dismiss()
            onClose()
          }}
          style={styles.backdropPressable}
        />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              shadowColor: theme.shadow,
              shadowOpacity: theme.isDark ? 0.38 : 0.16,
              transform: [{ translateY }],
            },
          ]}
        >
          <View {...panResponder.panHandlers} style={styles.dragRegion}>
            <View style={[styles.handle, { backgroundColor: theme.input }]} />
          </View>
          <WorkspacePickerContent
            bottomPadding={Math.max(insets.bottom, spacing.sm)}
            onClose={onClose}
            onDismissed={onDismissed}
            onSelect={onSelect}
            selectedWorkspaceId={selectedWorkspaceId}
            visible={visible}
            workspaces={workspaces}
          />
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  dragRegion: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
  },
  handle: {
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  modal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '78%',
    paddingTop: spacing.xs,
    shadowOffset: { height: -8, width: 0 },
    shadowRadius: 28,
  },
})
