import type { UIMessage } from 'ai'
/* eslint-disable react/no-array-index-key -- AI SDK text parts have no protocol id and their position is stable. */
import { isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai'
import { Check, CircleAlert, Copy, Wrench } from 'lucide-react-native'
import { memo, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import { NativeMarkdown } from '@/components/ui/native-markdown'
import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface ChatMessageProps {
  errorText?: string | null
  message: UIMessage
  onActivityPress?: (messageId: string) => void
  onCopy?: (text: string) => Promise<void>
  status?: 'streaming' | 'complete' | 'aborted' | 'failed'
}

function CopyAction({
  align = 'start',
  text,
  onCopy,
}: {
  align?: 'start' | 'end'
  text: string
  onCopy: (text: string) => Promise<void>
}) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
    }
  }, [])

  const copy = async () => {
    try {
      await onCopy(text)
      setCopied(true)
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = setTimeout(setCopied, 1_500, false)
    }
    catch {
      Alert.alert('Could not copy message')
    }
  }

  return (
    <PressableScale
      accessibilityLabel={copied ? 'Message copied' : 'Copy message'}
      accessibilityRole="button"
      haptic
      onPress={() => void copy()}
      style={[
        styles.copyAction,
        align === 'end' && styles.copyActionEnd,
        { backgroundColor: theme.surfaceInset },
      ]}
    >
      {copied
        ? <Check color={theme.success} size={14} />
        : <Copy color={theme.mutedForeground} size={14} />}
    </PressableScale>
  )
}

function ChatMessageContent({
  errorText = null,
  message,
  onActivityPress,
  onCopy,
  status = 'complete',
}: ChatMessageProps) {
  const theme = useTheme()
  const copyText = message.parts
    .filter(isTextUIPart)
    .map(part => part.text)
    .join('\n')
    .trim()

  if (message.role === 'user') {
    return (
      <View style={styles.userMessage}>
        <View style={[styles.userBubble, { backgroundColor: theme.muted }]}>
          <Text selectable style={[styles.userText, { color: theme.foreground }]}>
            {copyText}
          </Text>
        </View>
        {copyText && onCopy && <CopyAction align="end" onCopy={onCopy} text={copyText} />}
      </View>
    )
  }

  const activityParts = message.parts.filter(
    part => isReasoningUIPart(part) || isToolUIPart(part),
  )
  const toolParts = message.parts.filter(isToolUIPart)
  const running = toolParts.some(
    part =>
      part.state === 'input-streaming'
      || part.state === 'input-available'
      || part.state === 'approval-requested',
  )
  const failed = toolParts.some(
    part => part.state === 'output-error' || part.state === 'output-denied',
  )

  return (
    <View style={styles.assistantMessage}>
      {message.parts.map((part, index) => {
        if (isTextUIPart(part)) {
          if (!part.text) {
            return null
          }
          // Text parts have no protocol id; their position is stable for the life of a message.
          if (Platform.OS === 'ios') {
            return (
              <NativeMarkdown
                key={`text-${index}`}
                markdown={part.text}
                streaming={status === 'streaming'}
              />
            )
          }
          if (status === 'streaming') {
            return (
              <Text
                key={`text-${index}`}
                style={[styles.streamingText, { color: theme.foreground }]}
              >
                {part.text}
              </Text>
            )
          }

          return (
            <Markdown
              key={`text-${index}`}
              style={{
                body: {
                  color: theme.foreground,
                  fontSize: 14,
                  lineHeight: 22,
                  marginBottom: 0,
                  marginTop: 0,
                },
                bullet_list: {
                  marginBottom: spacing.sm,
                  marginTop: spacing.xs,
                },
                code_inline: {
                  backgroundColor: theme.muted,
                  borderRadius: radius.sm,
                  color: theme.foreground,
                  fontFamily: 'GeistMono_400Regular',
                  fontSize: 12,
                  paddingHorizontal: spacing.xs,
                },
                fence: {
                  backgroundColor: theme.muted,
                  borderColor: theme.border,
                  borderRadius: radius.md,
                  color: theme.foreground,
                  fontFamily: 'GeistMono_400Regular',
                  fontSize: 11,
                  lineHeight: 17,
                  marginVertical: spacing.sm,
                  padding: spacing.sm,
                },
                heading1: {
                  color: theme.foreground,
                  fontSize: 18,
                  lineHeight: 24,
                  marginBottom: spacing.sm,
                  marginTop: spacing.md,
                },
                heading2: {
                  color: theme.foreground,
                  fontSize: 16,
                  lineHeight: 22,
                  marginBottom: spacing.sm,
                  marginTop: spacing.md,
                },
                link: {
                  color: theme.info,
                },
                paragraph: {
                  marginBottom: spacing.sm,
                  marginTop: 0,
                },
              }}
            >
              {part.text}
            </Markdown>
          )
        }

        if (isReasoningUIPart(part)) {
          return null
        }

        if (isToolUIPart(part)) {
          return null
        }

        return null
      })}

      {activityParts.length > 0 && (
        <PressableScale
          accessibilityLabel="Open activity feed"
          accessibilityRole="button"
          disabled={!onActivityPress}
          onPress={onActivityPress ? () => onActivityPress(message.id) : undefined}
          style={[styles.activitySummary, { backgroundColor: theme.surfaceInset }]}
        >
          <View style={styles.activityIcon}>
            {running
              ? (
              <ActivityIndicator color={theme.tertiaryForeground} size="small" />
            )
              : failed
                ? (
              <CircleAlert color={theme.destructive} size={15} />
            )
                : (
              <Check color={theme.success} size={15} />
            )}
          </View>
          <Wrench color={theme.tertiaryForeground} size={14} />
          <Text style={[styles.activityLabel, { color: theme.tertiaryForeground }]}>
            {running ? 'Working' : `${toolParts.length || activityParts.length} activities`}
          </Text>
          <Text style={[styles.activityHint, { color: theme.mutedForeground }]}>Tap to view</Text>
        </PressableScale>
      )}

      {status === 'streaming' && (
        <Text
          accessibilityLabel="Streaming response"
          style={[styles.cursor, { color: theme.foreground }]}
        >
          {'\u258C'}
        </Text>
      )}
      {status === 'aborted' && (
        <Text style={[styles.terminalStatus, { color: theme.mutedForeground }]}>Stopped</Text>
      )}
      {status === 'failed' && errorText && (
        <Text style={[styles.terminalStatus, { color: theme.destructive }]}>{errorText}</Text>
      )}
      {copyText && onCopy && <CopyAction onCopy={onCopy} text={copyText} />}
    </View>
  )
}

export const ChatMessage = memo(ChatMessageContent)

const styles = StyleSheet.create({
  assistantMessage: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  activityHint: {
    flex: 1,
    fontSize: 11,
  },
  activityIcon: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  activityLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  activitySummary: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  cursor: {
    fontSize: 13,
    lineHeight: 16,
  },
  copyAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  copyActionEnd: {
    alignSelf: 'flex-end',
  },
  terminalStatus: {
    fontSize: 12,
    lineHeight: 18,
  },
  streamingText: {
    fontSize: 14,
    lineHeight: 22,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: radius.sm,
    borderRadius: radius.xl,
    maxWidth: '84%',
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,
  },
  userMessage: {
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  userText: {
    fontSize: 14,
    lineHeight: 20,
  },
})
