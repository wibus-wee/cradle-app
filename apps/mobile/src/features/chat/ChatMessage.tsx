import type { UIMessage } from 'ai'
import {
  getToolName,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
} from 'ai'
import { Check, CircleAlert, Wrench } from 'lucide-react-native'
import { memo } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import { NativeMarkdown } from '@/components/ui/native-markdown'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface ChatMessageProps {
  errorText?: string | null
  message: UIMessage
  status?: 'streaming' | 'complete' | 'aborted' | 'failed'
}

export const ChatMessage = memo(function ChatMessage({
  errorText = null,
  message,
  status = 'complete',
}: ChatMessageProps) {
  const theme = useTheme()

  if (message.role === 'user') {
    const text = message.parts
      .filter(isTextUIPart)
      .map(part => part.text)
      .join('')
    return (
      <View style={[styles.userBubble, { backgroundColor: theme.muted }]}>
        <Text selectable style={[styles.userText, { color: theme.foreground }]}>{text}</Text>
      </View>
    )
  }

  return (
    <View style={styles.assistantMessage}>
      {message.parts.map((part, index) => {
        if (isTextUIPart(part)) {
          if (!part.text) { return null }
          return Platform.OS === 'ios'
            ? <NativeMarkdown key={`text-${index}`} markdown={part.text} streaming={status === 'streaming'} />
            : (
                <Markdown
                  // Text parts have no protocol id; their position is stable for the life of a message.
                  // eslint-disable-next-line react/no-array-index-key
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
          if (!part.text) { return null }
          return (
            <View
              // Reasoning parts have no protocol id; their position is stable for the life of a message.
              // eslint-disable-next-line react/no-array-index-key
              key={`reasoning-${index}`}
              style={[styles.reasoning, { borderLeftColor: theme.border }]}
            >
              <Text selectable style={[styles.reasoningText, { color: theme.mutedForeground }]}>
                {part.text}
              </Text>
            </View>
          )
        }

        if (isToolUIPart(part)) {
          const running = part.state === 'input-streaming'
            || part.state === 'input-available'
            || part.state === 'approval-requested'
          const failed = part.state === 'output-error' || part.state === 'output-denied'
          return (
            <View
              key={part.toolCallId}
              style={[
                styles.tool,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.toolIcon}>
                {running
                  ? <ActivityIndicator color={theme.tertiaryForeground} size="small" />
                  : failed
                    ? <CircleAlert color={theme.destructive} size={15} />
                    : <Check color={theme.success} size={15} />}
              </View>
              <Wrench color={theme.tertiaryForeground} size={14} />
              <Text numberOfLines={1} style={[styles.toolName, { color: theme.tertiaryForeground }]}>
                {part.title ?? getToolName(part)}
              </Text>
            </View>
          )
        }

        return null
      })}

      {status === 'streaming' && (
        <Text accessibilityLabel="Streaming response" style={[styles.cursor, { color: theme.foreground }]}>
          {'\u258C'}
        </Text>
      )}
      {status === 'aborted' && (
        <Text style={[styles.terminalStatus, { color: theme.mutedForeground }]}>Stopped</Text>
      )}
      {status === 'failed' && errorText && (
        <Text style={[styles.terminalStatus, { color: theme.destructive }]}>{errorText}</Text>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  assistantMessage: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  cursor: {
    fontSize: 13,
    lineHeight: 16,
  },
  reasoning: {
    borderLeftWidth: 2,
    paddingLeft: spacing.sm,
  },
  reasoningText: {
    fontSize: 12,
    lineHeight: 18,
  },
  terminalStatus: {
    fontSize: 12,
    lineHeight: 18,
  },
  tool: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 32,
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
  },
  toolIcon: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  toolName: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: radius.sm,
    borderRadius: radius.xl,
    maxWidth: '84%',
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,
  },
  userText: {
    fontSize: 14,
    lineHeight: 20,
  },
})
