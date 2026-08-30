import { ArrowUp, ChevronDown, GitBranch, Plus } from 'lucide-react-native'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { GetWorkspacesResponse, PostWorksData } from '@/api-gen'
import { NativeMaterialView } from '@/components/ui/native-material-view'
import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { WorkspacePickerSheet } from './WorkspacePickerSheet'

type Workspace = GetWorkspacesResponse[number]
type ComposerSnap = 0 | 0.5 | 1

interface WorkComposerProps {
  initialWorkspaceId?: string
  isCreating: boolean
  onCreate: (input: PostWorksData['body']) => void
  showWorkType?: boolean
  workspaces: Workspace[]
}

export interface WorkComposerHandle {
  collapse: () => void
}

export const WorkComposer = forwardRef<WorkComposerHandle, WorkComposerProps>(({
  initialWorkspaceId,
  isCreating,
  onCreate,
  showWorkType = false,
  workspaces,
}, ref) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const inputRef = useRef<TextInput>(null)
  const initialWorkspaceIdRef = useRef(initialWorkspaceId)
  const isClosingRef = useRef(false)
  const workspacePickerOpenRef = useRef(false)
  const dragStartRef = useRef(0.5)
  const isDraggingRef = useRef(false)
  const gestureCandidateRef = useRef(false)
  const blurGuardUntilRef = useRef(0)
  const expansion = useRef(new Animated.Value(0)).current
  const [expanded, setExpanded] = useState(false)
  const [workspaceId, setWorkspaceId] = useState(
    initialWorkspaceId ?? workspaces[0]?.id ?? '',
  )
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [text, setText] = useState('')
  const [keyboardTop, setKeyboardTop] = useState<number | null>(() => Keyboard.metrics()?.screenY ?? null)
  const workspace = workspaces.find(item => item.id === workspaceId) ?? workspaces[0]
  const composerMaxHeight = keyboardTop === null
    ? Math.min(windowHeight * 0.74, 620)
    : Math.max(
        218,
        Math.min(windowHeight * 0.74, keyboardTop - insets.top - spacing.md),
      )

  useEffect(() => {
    const changeEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const change = Keyboard.addListener(changeEvent, (event) => {
      setKeyboardTop(event.endCoordinates.screenY)
    })
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardTop(null)
    })
    return () => {
      change.remove()
      hide.remove()
    }
  }, [])

  useEffect(() => {
    const nextWorkspaceId = initialWorkspaceId ?? workspaces[0]?.id ?? ''
    const initialWorkspaceChanged = initialWorkspaceIdRef.current !== initialWorkspaceId
    if (initialWorkspaceChanged || !workspaces.some(item => item.id === workspaceId)) {
      setWorkspaceId(nextWorkspaceId)
    }
    initialWorkspaceIdRef.current = initialWorkspaceId
  }, [initialWorkspaceId, workspaceId, workspaces])

  const animateTo = useCallback((target: ComposerSnap, focus = false) => {
    if (target === 0) {
      isClosingRef.current = true
      inputRef.current?.blur()
      Keyboard.dismiss()
    }
    else {
      setExpanded(true)
    }
    expansion.stopAnimation()
    Animated.spring(expansion, {
      damping: 34,
      mass: 1,
      stiffness: 520,
      toValue: target,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) { return }
      if (target === 0) {
        setExpanded(false)
        isClosingRef.current = false
      }
      else if (focus) {
        inputRef.current?.focus()
      }
    })
  }, [expansion])

  const open = () => {
    if (expanded || isClosingRef.current) { return }
    animateTo(0.5, true)
  }

  const close = useCallback(() => {
    if (!expanded || isClosingRef.current) { return }
    animateTo(0)
  }, [animateTo, expanded])

  useImperativeHandle(ref, () => ({ collapse: close }), [close])

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      isDraggingRef.current = true
      expansion.stopAnimation((value) => {
        dragStartRef.current = value
      })
    },
    onPanResponderMove: (_, gesture) => {
      const next = Math.max(0, Math.min(1, dragStartRef.current - gesture.dy / 320))
      expansion.setValue(next)
    },
    onPanResponderRelease: (_, gesture) => {
      isDraggingRef.current = false
      blurGuardUntilRef.current = Date.now() + 260
      gestureCandidateRef.current = false
      const current = Math.max(0, Math.min(1, dragStartRef.current - gesture.dy / 320))
      const projected = Math.max(0, Math.min(1, current - gesture.vy * 0.16))
      const target: ComposerSnap = projected < 0.25
        ? 0
        : projected < 0.75
          ? 0.5
          : 1
      animateTo(target, target > 0 && dragStartRef.current === 0)
    },
    onPanResponderTerminate: () => {
      isDraggingRef.current = false
      blurGuardUntilRef.current = Date.now() + 260
      gestureCandidateRef.current = false
      animateTo(dragStartRef.current < 0.25 ? 0 : dragStartRef.current < 0.75 ? 0.5 : 1)
    },
    onPanResponderTerminationRequest: () => false,
  }), [animateTo, expansion])

  const submit = () => {
    const objective = text.trim()
    if (!workspace || !objective || isCreating) { return }
    onCreate({
      objective,
      title: objective,
      workspaceId: workspace.id,
    })
  }

  const collapsedOpacity = expansion.interpolate({
    inputRange: [0, 0.28],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  })
  const expandedOpacity = expansion.interpolate({
    inputRange: [0.22, 0.62],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })
  const inputOpacity = expansion.interpolate({
    inputRange: [0.34, 0.72],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })
  const footerOpacity = expansion.interpolate({
    inputRange: [0.48, 0.88],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })
  const frameRadius = expansion.interpolate({
    inputRange: [0, 1],
    outputRange: [29, radius.xxl],
  })
  const surfaceRadius = expansion.interpolate({
    inputRange: [0, 1],
    outputRange: [28, radius.xxl - 1],
  })

  const openWorkspacePicker = () => {
    workspacePickerOpenRef.current = true
    setWorkspacePickerOpen(true)
    Keyboard.dismiss()
  }

  const closeWorkspacePicker = useCallback(() => {
    Keyboard.dismiss()
    setWorkspacePickerOpen(false)
  }, [])

  const restoreComposerFocus = useCallback(() => {
    workspacePickerOpenRef.current = false
    if (expanded && !isClosingRef.current) {
      inputRef.current?.focus()
    }
  }, [expanded])

  return (
    <>
      <Animated.View
        style={[
          styles.composerFrame,
          {
            backgroundColor: theme.surface,
            borderColor: theme.input,
            borderRadius: frameRadius,
            height: expansion.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [58, 218, composerMaxHeight],
            }),
            shadowColor: theme.shadow,
            shadowOpacity: theme.shadowOpacity,
            shadowRadius: expansion.interpolate({
              inputRange: [0, 1],
              outputRange: [5, 8],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.composerSurface,
            {
              backgroundColor: 'transparent',
              borderRadius: surfaceRadius,
            },
          ]}
        >
          <NativeMaterialView
            glassStyle="regular"
            pointerEvents="none"
            style={styles.glass}
            tintColor={theme.glassTint}
          />

          <Animated.View
            pointerEvents={expanded ? 'none' : 'auto'}
            onTouchStart={() => {
              gestureCandidateRef.current = true
            }}
            onTouchEnd={() => {
              gestureCandidateRef.current = false
              blurGuardUntilRef.current = Date.now() + 260
            }}
            style={[
              styles.collapsedStage,
              {
                opacity: collapsedOpacity,
                transform: [{
                  translateY: expansion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                }],
              },
            ]}
          >
            <View {...panResponder.panHandlers} style={styles.collapsedGesture}>
              <PressableScale
                accessibilityLabel="Open Work Composer"
                accessibilityRole="button"
                haptic
                onPress={open}
                style={styles.collapsedPressable}
              >
                <View style={[styles.collapsedAdd, { backgroundColor: theme.muted }]}>
                  <Plus color={theme.tertiaryForeground} size={22} />
                </View>
                <Text numberOfLines={1} style={[styles.placeholder, { color: theme.mutedForeground }]}>
                  Plan, ask, build...
                </Text>
              </PressableScale>
            </View>
          </Animated.View>

          <View pointerEvents={expanded ? 'auto' : 'none'} style={styles.expandedStage}>
            <View
              {...panResponder.panHandlers}
              onTouchStart={() => {
                gestureCandidateRef.current = true
              }}
              onTouchEnd={() => {
                gestureCandidateRef.current = false
                blurGuardUntilRef.current = Date.now() + 260
              }}
              style={styles.handleGesture}
            >
              <PressableScale
                accessibilityLabel="Resize Work Composer"
                accessibilityRole="adjustable"
                onPress={close}
                style={styles.handleButton}
              >
                <View style={[styles.handle, { backgroundColor: theme.muted }]} />
              </PressableScale>
            </View>

            <Animated.View
              style={[
                styles.contextRow,
                {
                  opacity: expandedOpacity,
                  transform: [{
                    translateY: expansion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0],
                    }),
                  }],
                },
              ]}
            >
              <PressableScale
                accessibilityLabel="Choose repository"
                accessibilityRole="button"
                onPress={openWorkspacePicker}
                style={[styles.contextButton, styles.contextMenu]}
              >
                <Text numberOfLines={1} style={[styles.contextLabel, { color: theme.foreground }]}>
                  {workspace?.name ?? 'Choose repository'}
                </Text>
                <ChevronDown color={theme.mutedForeground} size={15} />
              </PressableScale>

              <View style={styles.contextButton}>
                <GitBranch color={theme.tertiaryForeground} size={16} />
                <Text numberOfLines={1} style={[styles.contextLabel, { color: theme.foreground }]}>
                  Current checkout
                </Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[
                styles.inputStage,
                {
                  opacity: inputOpacity,
                  transform: [{
                    translateY: expansion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  }],
                },
              ]}
            >
              <TextInput
                maxLength={12_000}
                multiline
                onBlur={() => {
                  if (
                    !workspacePickerOpenRef.current
                    && !isDraggingRef.current
                    && !gestureCandidateRef.current
                    && Date.now() > blurGuardUntilRef.current
                  ) {
                    close()
                  }
                }}
                onChangeText={setText}
                placeholder="Plan, ask, build..."
                placeholderTextColor={theme.mutedForeground}
                ref={inputRef}
                style={[styles.input, { color: theme.foreground }]}
                textAlignVertical="top"
                value={text}
              />
            </Animated.View>

            <Animated.View
              style={[
                styles.footer,
                !showWorkType && styles.footerEnd,
                {
                  opacity: footerOpacity,
                  transform: [{
                    translateY: expansion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0],
                    }),
                  }],
                },
              ]}
            >
              {showWorkType && (
                <View style={styles.workType}>
                  <GitBranch color={theme.foreground} size={16} />
                  <Text style={[styles.workTypeLabel, { color: theme.foreground }]}>
                    Isolated Work
                  </Text>
                </View>
              )}

              <PressableScale
                accessibilityLabel="Create Work"
                accessibilityRole="button"
                disabled={!workspace || !text.trim() || isCreating}
                haptic
                onPress={submit}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: text.trim() ? theme.primary : theme.muted,
                  },
                ]}
              >
                {isCreating
                  ? <ActivityIndicator color={theme.primaryForeground} size="small" />
                  : (
                      <ArrowUp
                        color={text.trim() ? theme.primaryForeground : theme.mutedForeground}
                        size={20}
                        strokeWidth={2.2}
                      />
                    )}
              </PressableScale>
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
      <WorkspacePickerSheet
        onClose={closeWorkspacePicker}
        onDismissed={restoreComposerFocus}
        onSelect={setWorkspaceId}
        selectedWorkspaceId={workspace?.id ?? ''}
        visible={workspacePickerOpen}
        workspaces={workspaces}
      />
    </>
  )
})

const styles = StyleSheet.create({
  collapsedAdd: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  collapsedPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: 6,
    paddingRight: spacing.md,
  },
  collapsedStage: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
  collapsedGesture: {
    flex: 1,
  },
  composerFrame: {
    borderWidth: 1,
    shadowOffset: { height: 1, width: 0 },
  },
  composerSurface: {
    flex: 1,
    overflow: 'hidden',
  },
  contextButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
  },
  contextLabel: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  contextRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  contextMenu: {
    flexShrink: 1,
  },
  expandedStage: {
    flex: 1,
    paddingBottom: spacing.sm,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  footerEnd: {
    justifyContent: 'flex-end',
  },
  glass: {
    ...StyleSheet.absoluteFill,
  },
  handle: {
    borderRadius: 2,
    height: 4,
    width: 40,
  },
  handleGesture: {
    height: 32,
  },
  handleButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    minHeight: 74,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputStage: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    fontSize: 15,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  workType: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  workTypeLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
})
