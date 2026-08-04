import type { UIMessage } from 'ai'
import { ArrowUp, Square } from 'lucide-react-native'
import { useRef, useState } from 'react'
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import type {
  GetChatSessionsBySessionIdMessagesResponse,
  GetChatSessionsBySessionIdRunSnapshotsResponse,
  GetSessionsResponse,
} from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { durationLabel } from '@/lib/format'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ChatMessage } from './ChatMessage'

type Session = GetSessionsResponse[number]
type MessageRow = GetChatSessionsBySessionIdMessagesResponse['rows'][number]
type RunSnapshot = GetChatSessionsBySessionIdRunSnapshotsResponse['snapshots'][number]

export interface ChatViewProps {
  session: Session
  messages: MessageRow[]
  activeRun?: RunSnapshot
  isCancelling?: boolean
  isSending?: boolean
  isStreaming?: boolean
  liveMessage?: UIMessage | null
  pendingUser?: { id: string | null, text: string } | null
  queuedCount?: number
  sendError?: string | null
  onCancel: () => void
  onSend: (text: string) => void
}

export function ChatView({
  messages,
  activeRun,
  isCancelling = false,
  isSending = false,
  isStreaming = false,
  liveMessage = null,
  pendingUser = null,
  queuedCount = 0,
  sendError = null,
  onCancel,
  onSend,
}: ChatViewProps) {
  const theme = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const shouldFollowStreamRef = useRef(true)
  const [text, setText] = useState('')

  const submit = () => {
    const next = text.trim()
    if (!next || isSending) { return }
    setText('')
    onSend(next)
  }
  const durableIds = new Set(messages.map(row => row.messageId))
  const showPendingUser = pendingUser
    && (!pendingUser.id || !durableIds.has(pendingUser.id))
  const showLiveMessage = liveMessage && !durableIds.has(liveMessage.id)
  const messageCount = messages.length + (showPendingUser ? 1 : 0) + (showLiveMessage ? 1 : 0)

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    shouldFollowStreamRef.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 72
  }

  const followStream = () => {
    if (shouldFollowStreamRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false })
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.chrome }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={styles.keyboard}
      >
        <View style={[styles.surface, { backgroundColor: theme.surfaceInset }]}>
          <ScrollView
            contentContainerStyle={[
              styles.messages,
              messageCount === 0 && styles.emptyMessages,
            ]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={followStream}
            onScroll={handleScroll}
            ref={scrollRef}
            scrollEventThrottle={32}
          >
            {messageCount === 0 && (
              <Text style={[styles.emptyText, { color: theme.mutedForeground }]}>
                Start the conversation
              </Text>
            )}

            {messages.map((row) => {
              const message = liveMessage?.id === row.messageId
                ? liveMessage
                : row.message as UIMessage
              return (
                <ChatMessage
                  errorText={row.errorText}
                  key={row.messageId}
                  message={message}
                  status={liveMessage?.id === row.messageId ? 'streaming' : row.status}
                />
              )
            })}

            {showPendingUser && (
              <ChatMessage
                message={{
                  id: pendingUser.id ?? 'pending-user',
                  parts: [{ text: pendingUser.text, type: 'text' }],
                  role: 'user',
                }}
              />
            )}

            {showLiveMessage && (
              <ChatMessage message={liveMessage} status={isStreaming ? 'streaming' : 'complete'} />
            )}
          </ScrollView>

          <View
            style={[
              styles.composerFrame,
              {
                backgroundColor: theme.chrome,
                borderTopColor: theme.chromeBorder,
              },
            ]}
          >
            {isStreaming && (
              <View style={styles.runStatus}>
                <View style={[styles.progressDot, { backgroundColor: theme.success }]} />
                <Text style={[styles.progressText, { color: theme.tertiaryForeground }]}>
                  {activeRun
                    ? `Working ${durationLabel(activeRun.startedAt, activeRun.completedAt)}`
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
                    ? <ActivityIndicator color={theme.foreground} size="small" />
                    : <Square color={theme.foreground} fill={theme.foreground} size={11} />}
                </PressableScale>
              </View>
            )}

            {sendError && (
              <Text style={[styles.sendError, { color: theme.destructive }]}>{sendError}</Text>
            )}

            <View
              style={[
                styles.composer,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.input,
                },
              ]}
            >
              <TextInput
                maxLength={12_000}
                multiline
                onChangeText={setText}
                placeholder={isStreaming ? 'Add to queue' : 'Message'}
                placeholderTextColor={theme.mutedForeground}
                selectionColor={theme.info}
                style={[styles.input, { color: theme.foreground }]}
                value={text}
              />
              <PressableScale
                accessibilityLabel={isStreaming ? 'Queue message' : 'Send message'}
                accessibilityRole="button"
                disabled={!text.trim() || isSending}
                haptic
                onPress={submit}
                style={[
                  styles.sendButton,
                  { backgroundColor: text.trim() ? theme.primary : theme.muted },
                ]}
              >
                {isSending
                  ? <ActivityIndicator color={theme.primaryForeground} size="small" />
                  : (
                      <ArrowUp
                        color={text.trim() ? theme.primaryForeground : theme.mutedForeground}
                        size={18}
                        strokeWidth={2.3}
                      />
                    )}
              </PressableScale>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  composer: {
    alignItems: 'flex-end',
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 46,
    padding: 4,
    paddingLeft: 12,
  },
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
  input: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 112,
    minHeight: 36,
    paddingBottom: 8,
    paddingTop: 8,
  },
  keyboard: {
    flex: 1,
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
  sendButton: {
    alignItems: 'center',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
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
