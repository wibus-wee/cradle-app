import type { MenuAction } from '@expo/ui/community/menu'
import { MenuView } from '@expo/ui/community/menu'
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect'
import { ArrowUp, ChevronDown, GitBranch, Plus } from 'lucide-react-native'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

import type { GetWorkspacesResponse, PostWorksData } from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { WorkspacePickerSheet } from './WorkspacePickerSheet'

type Workspace = GetWorkspacesResponse[number]
type BaseStrategy = NonNullable<PostWorksData['body']['baseStrategy']>

interface WorkComposerProps {
  initialWorkspaceId?: string
  isCreating: boolean
  onCreate: (input: PostWorksData['body']) => void
  workspaces: Workspace[]
}

export interface WorkComposerHandle {
  collapse: () => void
}

const baseStrategies: Array<{
  image: NonNullable<MenuAction['image']>
  label: string
  value: BaseStrategy
}> = [
  { image: 'arrow.triangle.branch', label: 'Current HEAD', value: 'source-head' },
  { image: 'cloud', label: 'Remote default branch', value: 'remote-default' },
]

const supportsLiquidGlass = isGlassEffectAPIAvailable() && isLiquidGlassAvailable()

export const WorkComposer = forwardRef<WorkComposerHandle, WorkComposerProps>(({
  initialWorkspaceId,
  isCreating,
  onCreate,
  workspaces,
}, ref) => {
  const theme = useTheme()
  const inputRef = useRef<TextInput>(null)
  const initialWorkspaceIdRef = useRef(initialWorkspaceId)
  const isClosingRef = useRef(false)
  const workspacePickerOpenRef = useRef(false)
  const expansion = useRef(new Animated.Value(0)).current
  const [expanded, setExpanded] = useState(false)
  const [workspaceId, setWorkspaceId] = useState(
    initialWorkspaceId ?? workspaces[0]?.id ?? '',
  )
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [baseStrategy, setBaseStrategy] = useState<BaseStrategy>('source-head')
  const [text, setText] = useState('')
  const workspace = workspaces.find(item => item.id === workspaceId) ?? workspaces[0]
  const base = baseStrategies.find(item => item.value === baseStrategy) ?? baseStrategies[0]!

  useEffect(() => {
    const nextWorkspaceId = initialWorkspaceId ?? workspaces[0]?.id ?? ''
    const initialWorkspaceChanged = initialWorkspaceIdRef.current !== initialWorkspaceId
    if (initialWorkspaceChanged || !workspaces.some(item => item.id === workspaceId)) {
      setWorkspaceId(nextWorkspaceId)
    }
    initialWorkspaceIdRef.current = initialWorkspaceId
  }, [initialWorkspaceId, workspaceId, workspaces])

  const open = () => {
    if (expanded || isClosingRef.current) { return }
    setExpanded(true)
    Animated.spring(expansion, {
      damping: 40,
      mass: 1,
      stiffness: 600,
      toValue: 1,
      useNativeDriver: false,
    }).start(() => inputRef.current?.focus())
  }

  const close = useCallback(() => {
    if (!expanded || isClosingRef.current) { return }
    isClosingRef.current = true
    inputRef.current?.blur()
    Keyboard.dismiss()
    Animated.spring(expansion, {
      damping: 40,
      mass: 1,
      stiffness: 600,
      toValue: 0,
      useNativeDriver: false,
    }).start(() => {
      setExpanded(false)
      isClosingRef.current = false
    })
  }, [expanded, expansion])

  useImperativeHandle(ref, () => ({ collapse: close }), [close])

  const submit = () => {
    const objective = text.trim()
    if (!workspace || !objective || isCreating) { return }
    onCreate({
      baseStrategy,
      objective,
      title: objective,
      workspaceId: workspace.id,
    })
  }

  const baseActions: MenuAction[] = baseStrategies.map(item => ({
    id: item.value,
    image: item.image,
    state: item.value === baseStrategy ? 'on' : 'off',
    title: item.label,
  }))

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
          styles.composer,
          {
            backgroundColor: supportsLiquidGlass ? 'transparent' : theme.surface,
            borderColor: theme.input,
            borderRadius: expansion.interpolate({
              inputRange: [0, 1],
              outputRange: [29, radius.xxl],
            }),
            height: expansion.interpolate({
              inputRange: [0, 1],
              outputRange: [58, 218],
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
      {supportsLiquidGlass && (
        <GlassView
          colorScheme={theme.isDark ? 'dark' : 'light'}
          glassEffectStyle="regular"
          pointerEvents="none"
          style={styles.glass}
          tintColor={theme.glassTint}
        />
      )}

      <Animated.View
        pointerEvents={expanded ? 'none' : 'auto'}
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
      </Animated.View>

      <View pointerEvents={expanded ? 'auto' : 'none'} style={styles.expandedStage}>
        <PressableScale
          accessibilityLabel="Collapse Work Composer"
          accessibilityRole="button"
          onPress={close}
          style={styles.handleButton}
        >
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
        </PressableScale>

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

          <MenuView
            actions={baseActions}
            onPressAction={({ nativeEvent }) => {
              const next = baseStrategies.find(item => item.value === nativeEvent.event)
              if (next) { setBaseStrategy(next.value) }
            }}
            style={styles.contextMenu}
          >
            <View style={styles.contextButton}>
              <GitBranch color={theme.tertiaryForeground} size={16} />
              <Text numberOfLines={1} style={[styles.contextLabel, { color: theme.foreground }]}>
                {base.label}
              </Text>
              <ChevronDown color={theme.mutedForeground} size={15} />
            </View>
          </MenuView>
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
              if (!workspacePickerOpenRef.current) { close() }
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
          <View style={styles.workType}>
            <MenuView
              actions={baseActions}
              onPressAction={({ nativeEvent }) => {
                const next = baseStrategies.find(item => item.value === nativeEvent.event)
                if (next) { setBaseStrategy(next.value) }
              }}
            >
              <View style={[styles.addButton, { backgroundColor: theme.muted }]}>
                <Plus color={theme.tertiaryForeground} size={20} />
              </View>
            </MenuView>
            <GitBranch color={theme.foreground} size={16} />
            <Text style={[styles.workTypeLabel, { color: theme.foreground }]}>Isolated Work</Text>
          </View>

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
  addButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
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
  composer: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOffset: { height: 1, width: 0 },
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
  glass: {
    ...StyleSheet.absoluteFill,
  },
  handle: {
    borderRadius: 2,
    height: 4,
    width: 40,
  },
  handleButton: {
    alignItems: 'center',
    height: 20,
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
