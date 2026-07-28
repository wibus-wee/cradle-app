import { ArrowLeft, Send, Square } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Markdown from 'react-native-markdown-display'
import { SafeAreaView } from 'react-native-safe-area-context'

import type {
  GetChatSessionsBySessionIdMessagesResponse,
  GetChatSessionsBySessionIdRunSnapshotsResponse,
  GetSessionsResponse,
} from '@/api-gen'
import { Button } from '@/components/ui/button'
import { PressableScale } from '@/components/ui/pressable-scale'
import { StatusPill } from '@/components/ui/status-pill'
import { durationLabel, relativeTime } from '@/lib/format'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Session = GetSessionsResponse[number]
type MessageRow = GetChatSessionsBySessionIdMessagesResponse['rows'][number]
type RunSnapshot = GetChatSessionsBySessionIdRunSnapshotsResponse['snapshots'][number]

export interface ChatViewProps {
  session: Session
  messages: MessageRow[]
  activeRun?: RunSnapshot
  isSending?: boolean
  sendError?: string | null
  onBack: () => void
  onCancel: () => void
  onSend: (text: string) => void
}

function statusTone(status: Session['status']) {
  if (status === 'streaming') { return 'success' as const }
  if (status === 'error') { return 'danger' as const }
  return 'neutral' as const
}

export function ChatView({
  session,
  messages,
  activeRun,
  isSending = false,
  sendError = null,
  onBack,
  onCancel,
  onSend,
}: ChatViewProps) {
  const theme = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [messages])

  const submit = () => {
    const next = text.trim()
    if (!next) { return }
    setText('')
    onSend(next)
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
        style={styles.keyboard}
      >
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <PressableScale accessibilityLabel="Back" onPress={onBack} style={styles.iconButton}>
            <ArrowLeft color={theme.foreground} size={21} />
          </PressableScale>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
              {session.title ?? 'Untitled conversation'}
            </Text>
            <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
              {session.runtimeKind}
{' '}
·
{relativeTime(session.updatedAt)}
            </Text>
          </View>
          <StatusPill label={session.status} tone={statusTone(session.status)} />
        </View>

        {activeRun?.status === 'running' && (
          <View style={[styles.progress, { backgroundColor: `${theme.success}12`, borderBottomColor: theme.border }]}>
            <View style={[styles.progressDot, { backgroundColor: theme.success }]} />
            <Text style={[styles.progressText, { color: theme.foreground }]}>
              Working for
{' '}
{durationLabel(activeRun.startedAt, activeRun.completedAt)}
            </Text>
            <Text style={[styles.eventCount, { color: theme.mutedForeground }]}>
              {activeRun.eventCount}
{' '}
events
            </Text>
          </View>
        )}

        <ScrollView
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
        >
          {messages.map(row => (
            <View
              key={row.messageId}
              style={[
                styles.message,
                row.role === 'user'
                  ? { alignSelf: 'flex-end', backgroundColor: theme.primary }
                  : { alignSelf: 'stretch', backgroundColor: theme.card, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
              ]}
            >
              {row.role === 'assistant'
                ? (
                    <Markdown
                      style={{
                        body: {
                          color: theme.foreground,
                          fontFamily: 'Geist_400Regular',
                          fontSize: 15,
                          lineHeight: 23,
                        },
                        code_inline: {
                          backgroundColor: theme.muted,
                          borderRadius: 4,
                          color: theme.foreground,
                          fontSize: 13,
                          paddingHorizontal: 4,
                        },
                        fence: {
                          backgroundColor: theme.muted,
                          borderColor: theme.border,
                          color: theme.foreground,
                          fontSize: 12,
                        },
                      }}
                    >
                      {row.preview || (row.status === 'streaming' ? 'Working...' : '')}
                    </Markdown>
                  )
                : (
                    <Text style={[styles.userText, { color: theme.primaryForeground }]}>
                      {row.preview}
                    </Text>
                  )}
              {row.status === 'failed' && row.errorText && (
                <Text style={[styles.messageError, { color: theme.destructive }]}>{row.errorText}</Text>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.composerFrame, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
          {sendError && <Text style={[styles.sendError, { color: theme.destructive }]}>{sendError}</Text>}
          <View style={[styles.composer, { backgroundColor: theme.card, borderColor: theme.input }]}>
            <TextInput
              maxLength={12_000}
              multiline
              onChangeText={setText}
              onSubmitEditing={submit}
              placeholder={session.status === 'streaming' ? 'Queue a follow-up...' : 'Continue working...'}
              placeholderTextColor={theme.mutedForeground}
              style={[styles.input, { color: theme.foreground }]}
              value={text}
            />
            {session.status === 'streaming'
              ? (
                  <PressableScale accessibilityLabel="Stop" onPress={onCancel} style={[styles.sendButton, { backgroundColor: theme.muted }]}>
                    <Square color={theme.foreground} fill={theme.foreground} size={15} />
                  </PressableScale>
                )
              : (
                  <PressableScale
                    accessibilityLabel="Send"
                    disabled={!text.trim() || isSending}
                    onPress={submit}
                    style={[styles.sendButton, { backgroundColor: text.trim() ? theme.primary : theme.muted }]}
                  >
                    <Send color={text.trim() ? theme.primaryForeground : theme.mutedForeground} size={17} />
                  </PressableScale>
                )}
          </View>
          {session.status === 'streaming' && text.trim() && (
            <Button
              icon={Send}
              label="Queue follow-up"
              loading={isSending}
              onPress={submit}
              style={styles.queueButton}
              variant="secondary"
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  composer: {
    alignItems: 'flex-end',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    padding: 5,
    paddingLeft: spacing.md,
  },
  composerFrame: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  eventCount: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  input: {
    flex: 1,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 120,
    minHeight: 40,
    paddingVertical: 9,
  },
  keyboard: {
    flex: 1,
  },
  message: {
    borderRadius: radius.lg,
    maxWidth: '88%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messageError: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    marginTop: spacing.sm,
  },
  messages: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  progress: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.lg,
  },
  progressDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  progressText: {
    flex: 1,
    fontFamily: 'Geist_500Medium',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  queueButton: {
    height: 42,
  },
  safeArea: {
    flex: 1,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sendError: {
    fontFamily: 'Geist_500Medium',
    fontSize: 12,
  },
  subtitle: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 15,
  },
  userText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
})
