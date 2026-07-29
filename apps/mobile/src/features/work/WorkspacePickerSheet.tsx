import { Check, FolderGit2, Search, X } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { GetWorkspacesResponse } from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Workspace = GetWorkspacesResponse[number]

interface WorkspacePickerSheetProps {
  onClose: () => void
  onDismissed?: () => void
  onSelect: (workspaceId: string) => void
  selectedWorkspaceId: string
  visible: boolean
  workspaces: Workspace[]
}

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
  const [query, setQuery] = useState('')

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
      setQuery('')
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

  const normalizedQuery = query.trim().toLowerCase()
  const filteredWorkspaces = normalizedQuery
    ? workspaces.filter(workspace =>
        workspace.name.toLowerCase().includes(normalizedQuery)
        || workspace.locator.path.toLowerCase().includes(normalizedQuery))
    : workspaces
  const showsSearch = workspaces.length > 5

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
              paddingBottom: Math.max(insets.bottom, spacing.sm),
              shadowColor: theme.shadow,
              shadowOpacity: theme.isDark ? 0.38 : 0.16,
              transform: [{ translateY }],
            },
          ]}
        >
          <View {...panResponder.panHandlers}>
            <View style={styles.dragRegion}>
              <View style={[styles.handle, { backgroundColor: theme.input }]} />
            </View>

            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.foreground }]}>Repository</Text>
              <PressableScale
                accessibilityLabel="Close repository picker"
                accessibilityRole="button"
                onPress={onClose}
                style={[styles.closeButton, { backgroundColor: theme.muted }]}
              >
                <X color={theme.tertiaryForeground} size={18} />
              </PressableScale>
            </View>
          </View>

          {showsSearch && (
            <View
              style={[
                styles.search,
                {
                  backgroundColor: theme.surfaceInset,
                  borderColor: theme.input,
                },
              ]}
            >
              <Search color={theme.mutedForeground} size={16} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Search repositories"
                placeholderTextColor={theme.mutedForeground}
                returnKeyType="search"
                style={[styles.searchInput, { color: theme.foreground }]}
                value={query}
              />
            </View>
          )}

          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            style={styles.list}
          >
            {filteredWorkspaces.map((workspace) => {
              const selected = workspace.id === selectedWorkspaceId
              const branch = workspace.gitIdentity.branch
              return (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={workspace.id}
                  onPress={() => {
                    onSelect(workspace.id)
                    onClose()
                  }}
                  style={[
                    styles.row,
                    selected && { backgroundColor: theme.muted },
                  ]}
                >
                  <View style={[styles.repositoryIcon, { backgroundColor: theme.surfaceInset }]}>
                    <FolderGit2 color={theme.workspace} size={18} />
                  </View>
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>
                      {workspace.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.rowDescription, { color: theme.mutedForeground }]}
                    >
                      {branch ? `${workspace.locator.path} / ${branch}` : workspace.locator.path}
                    </Text>
                  </View>
                  <View style={styles.checkSlot}>
                    {selected && <Check color={theme.workspace} size={18} strokeWidth={2.4} />}
                  </View>
                </PressableScale>
              )
            })}
            {filteredWorkspaces.length === 0 && (
              <Text style={[styles.empty, { color: theme.mutedForeground }]}>
                No repositories found
              </Text>
            )}
          </ScrollView>
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
  checkSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  dragRegion: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
  },
  empty: {
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  handle: {
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  modal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  repositoryIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  row: {
    alignItems: 'center',
    borderRadius: radius.xl,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  rowText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  search: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 40,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: 40,
    paddingVertical: 0,
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
  title: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
})
