import type { UIMessage } from 'ai'
import { Square } from 'lucide-react-native'
import { useMemo, useRef } from 'react'
import type { NativeSyntheticEvent, NativeTouchEvent } from 'react-native'
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import type {
  GetChatSessionsBySessionIdCapabilitiesResponse,
  GetChatSessionsBySessionIdMessagePreviewsResponse,
  GetChatSessionsBySessionIdRuntimeSettingsResponse,
  GetChatSessionsBySessionIdRuntimeStatusResponse,
} from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { useKeyboardOffset } from '@/hooks/use-keyboard-offset'
import { durationLabel } from '@/lib/format'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ChatActivitySheet } from './ChatActivitySheet'
import type { ChatComposerDraft, ChatSubmitInput } from './ChatComposer'
import { ChatComposer } from './ChatComposer'
import { ChatMessage } from './ChatMessage'

type MessageRow = GetChatSessionsBySessionIdMessagePreviewsResponse['rows'][number]
type ActiveRun = NonNullable<GetChatSessionsBySessionIdRuntimeStatusResponse['activeRun']>
type MessageItem = { kind: 'message', row: MessageRow }
type PendingItem = { kind: 'pending', id: string, message: UIMessage }
type LiveItem = { kind: 'live', id: string, message: UIMessage }
type TranscriptItem = MessageItem | PendingItem | LiveItem

export interface ChatViewProps {
  capabilities?: GetChatSessionsBySessionIdCapabilitiesResponse
  clearComposerDraftSignal: number
  composerDraft: ChatComposerDraft
  composerDraftKey: string
  messages: MessageRow[]
  activeRun?: ActiveRun
  hasEarlier: boolean
  isLoadingEarlier?: boolean
  detailMessage?: UIMessage
  detailMessageId?: string | null
  isLoadingMessageDetail?: boolean
  messageDetailError?: string | null
  isCancelling?: boolean
  isSending?: boolean
  isStreaming?: boolean
  liveMessage?: UIMessage | null
  pendingUser?: { id: string | null, text: string } | null
  queuedCount?: number
  sendError?: string | null
  onCancel: () => void
  onComposerDraftChange: (draft: ChatComposerDraft) => void
  onLoadEarlier: () => void
  onModeChange: (mode: 'build' | 'plan') => void
  onRequestMessageDetail: (messageId: string | null) => void
  onSend: (input: ChatSubmitInput) => void
  runtimeSettings?: GetChatSessionsBySessionIdRuntimeSettingsResponse
}

export function ChatView({
  capabilities,
  clearComposerDraftSignal,
  composerDraft,
  composerDraftKey,
  messages,
  activeRun,
  hasEarlier,
  isLoadingEarlier = false,
  detailMessage,
  detailMessageId = null,
  isLoadingMessageDetail = false,
  messageDetailError = null,
  isCancelling = false,
  isSending = false,
  isStreaming = false,
  liveMessage = null,
  pendingUser = null,
  queuedCount = 0,
  sendError = null,
  onCancel,
  onComposerDraftChange,
  onLoadEarlier,
  onModeChange,
  onRequestMessageDetail,
  onSend,
  runtimeSettings,
}: ChatViewProps) {
  const theme = useTheme()
  const keyboardOffset = useKeyboardOffset(true, spacing.xs)
  const keyboardInset = keyboardOffset.interpolate({
    inputRange: [-600, 0],
    outputRange: [600, 0],
    extrapolate: 'clamp',
  })
  const listTouchStartRef = useRef({ pageX: 0, pageY: 0 })
  const listTouchMovedRef = useRef(false)
  const items = useMemo<TranscriptItem[]>(() => {
    const durableIds = new Set(messages.map(row => row.messageId))
    const showPendingUser = pendingUser && (!pendingUser.id || !durableIds.has(pendingUser.id))
    const showLiveMessage = liveMessage && !durableIds.has(liveMessage.id)
    return [
      ...messages.map(row => ({ kind: 'message' as const, row })),
      ...(showPendingUser && pendingUser
        ? [
            {
              kind: 'pending' as const,
              id: pendingUser.id ?? 'pending-user',
              message: {
                id: pendingUser.id ?? 'pending-user',
                parts: [{ text: pendingUser.text, type: 'text' as const }],
                role: 'user' as const,
              },
            },
          ]
        : []),
      ...(showLiveMessage && liveMessage
        ? [{ kind: 'live' as const, id: liveMessage.id, message: liveMessage }]
        : []),
    ]
  }, [liveMessage, messages, pendingUser])
  const displayItems = useMemo(() => [...items].reverse(), [items])
  const activityMessage = useMemo(() => {
    if (!detailMessageId) {
      return undefined
    }
    if (detailMessage?.id === detailMessageId) {
      return detailMessage
    }
    const item = items.find(
      candidate =>
        (candidate.kind === 'message' ? candidate.row.messageId : candidate.id) === detailMessageId,
    )
    if (!item) {
      return undefined
    }
    return item.kind === 'message' ? (item.row.message as UIMessage) : item.message
  }, [detailMessage, detailMessageId, items])
  const handleEndReached = () => {
    if (hasEarlier && !isLoadingEarlier) {
      onLoadEarlier()
    }
  }
  const handleListTouchStart = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    listTouchStartRef.current = {
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    }
    listTouchMovedRef.current = false
  }
  const handleListTouchMove = (event: NativeSyntheticEvent<NativeTouchEvent>) => {
    const dx = event.nativeEvent.pageX - listTouchStartRef.current.pageX
    const dy = event.nativeEvent.pageY - listTouchStartRef.current.pageY
    if (Math.hypot(dx, dy) > 8) {
      listTouchMovedRef.current = true
    }
  }
  const handleListTouchEnd = () => {
    if (!listTouchMovedRef.current) {
      Keyboard.dismiss()
    }
    listTouchMovedRef.current = false
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.chrome }]}>
      <View style={styles.keyboard}>
        <View style={[styles.surface, { backgroundColor: theme.surfaceInset }]}>
          <FlatList
            contentContainerStyle={[
              styles.messages,
              displayItems.length === 0 && styles.emptyMessages,
            ]}
            data={displayItems}
            inverted
            keyboardDismissMode="none"
            keyboardShouldPersistTaps="always"
            ListHeaderComponent={(
              <Animated.View
                pointerEvents="none"
                style={[styles.keyboardSpacer, { height: keyboardInset }]}
              />
            )}
            keyExtractor={item =>
              `${item.kind}-${item.kind === 'message' ? item.row.messageId : item.id}`}
            ListEmptyComponent={(
              <Text style={[styles.emptyText, { color: theme.mutedForeground }]}>
                Start the conversation
              </Text>
            )}
            ListFooterComponent={
              hasEarlier
                ? (
                <View style={styles.earlierHeader}>
                  {isLoadingEarlier && (
                    <ActivityIndicator color={theme.mutedForeground} size="small" />
                  )}
                </View>
              )
                : null
            }
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.2}
            onTouchEnd={handleListTouchEnd}
            onTouchMove={handleListTouchMove}
            onTouchStart={handleListTouchStart}
            renderItem={({ item }) => {
              if (item.kind === 'message') {
                const message
                  = liveMessage?.id === item.row.messageId
                    ? liveMessage
                    : detailMessage?.id === item.row.messageId
                      ? detailMessage
                      : (item.row.message as UIMessage)
                return (
                  <ChatMessage
                    errorText={item.row.errorText}
                    message={message}
                    onActivityPress={onRequestMessageDetail}
                    status={liveMessage?.id === item.row.messageId ? 'streaming' : item.row.status}
                  />
                )
              }
              return (
                <ChatMessage
                  message={item.message}
                  onActivityPress={item.kind === 'live' ? onRequestMessageDetail : undefined}
                  status={
                    item.kind === 'live' ? (isStreaming ? 'streaming' : 'complete') : undefined
                  }
                />
              )
            }}
            scrollEventThrottle={32}
          />

          <ChatActivitySheet
            error={messageDetailError}
            isLoading={isLoadingMessageDetail}
            message={activityMessage}
            onClose={() => onRequestMessageDetail(null)}
            visible={detailMessageId !== null}
          />

          <Animated.View
            style={[
              styles.composerFrame,
              {
                backgroundColor: 'transparent',
                borderTopColor: theme.chromeBorder,
                transform: [{ translateY: keyboardOffset }],
              },
            ]}
          >
            {isStreaming && (
              <View style={styles.runStatus}>
                <View style={[styles.progressDot, { backgroundColor: theme.success }]} />
                <Text style={[styles.progressText, { color: theme.tertiaryForeground }]}>
                  {activeRun
                    ? `Working ${durationLabel(activeRun.startedAt, activeRun.finishedAt)}`
                    : 'Working'}
                </Text>
                {queuedCount > 0 && (
                  <Text style={[styles.queueCount, { color: theme.mutedForeground }]}>
                    {`${queuedCount} queued`}
                  </Text>
                )}
                <PressableScale
                  accessibilityLabel="Stop response"
                  accessibilityRole="button"
                  disabled={isCancelling}
                  haptic
                  onPress={onCancel}
                  style={[styles.stopButton, { backgroundColor: theme.muted }]}
                >
                  {isCancelling
                  ? (
                    <ActivityIndicator color={theme.foreground} size="small" />
                  )
                  : (
                    <Square color={theme.foreground} fill={theme.foreground} size={11} />
                  )}
                </PressableScale>
              </View>
            )}

            {sendError && (
              <Text style={[styles.sendError, { color: theme.destructive }]}>{sendError}</Text>
            )}

            <ChatComposer
              capabilities={capabilities}
              clearDraftSignal={clearComposerDraftSignal}
              initialDraft={composerDraft}
              isSending={isSending}
              isStreaming={isStreaming}
              key={composerDraftKey}
              onDraftChange={onComposerDraftChange}
              onModeChange={onModeChange}
              onSend={onSend}
              runtimeSettings={runtimeSettings}
            />
          </Animated.View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  composerFrame: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  earlierHeader: {
    alignItems: 'center',
    minHeight: 24,
    paddingBottom: spacing.xs,
  },
  keyboard: {
    flex: 1,
  },
  keyboardSpacer: {
    width: '100%',
  },
  messages: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  progressDot: {
    borderRadius: 4,
    height: 6,
    width: 6,
  },
  progressText: {
    flex: 1,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  queueCount: {
    fontSize: 11,
    lineHeight: 16,
  },
  runStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 32,
  },
  safeArea: {
    flex: 1,
  },
  sendError: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: spacing.xs,
  },
  stopButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  surface: {
    flex: 1,
  },
})
