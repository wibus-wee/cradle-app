import {
  getToolName,
  isReasoningUIPart,
} from 'ai'
import { Check, CircleAlert, LoaderCircle, Wrench, X } from 'lucide-react-native'
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { chatActivityParts, serializeChatActivity } from './chat-activity-model'
import type { ChatActivitySheetProps } from './chat-activity-sheet-contract'

export type { ChatActivitySheetProps } from './chat-activity-sheet-contract'

export function ChatActivitySheet({
  error = null,
  isLoading = false,
  message,
  onClose,
  visible,
}: ChatActivitySheetProps) {
  const theme = useTheme()
  const activities = chatActivityParts(message)

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView edges={['bottom']} style={[styles.safeArea, { backgroundColor: theme.surface }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View>
            <Text style={[styles.title, { color: theme.foreground }]}>Activity</Text>
            <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>Tools and reasoning</Text>
          </View>
          <PressableScale
            accessibilityLabel="Close activity"
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.closeButton, { backgroundColor: theme.muted }]}
          >
            <X color={theme.tertiaryForeground} size={18} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {isLoading && (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.mutedForeground} size="small" />
              <Text style={[styles.loadingText, { color: theme.mutedForeground }]}>Loading activity…</Text>
            </View>
          )}

          {activities.map((part) => {
            if (isReasoningUIPart(part)) {
              return (
                <View key={`reasoning-${part.text}`} style={[styles.reasoning, { backgroundColor: theme.surfaceInset }]}>
                  <View style={styles.activityHeading}>
                    <LoaderCircle color={theme.tertiaryForeground} size={15} />
                    <Text style={[styles.activityTitle, { color: theme.tertiaryForeground }]}>Reasoning</Text>
                  </View>
                  <Text selectable style={[styles.reasoningText, { color: theme.mutedForeground }]}>{part.text}</Text>
                </View>
              )
            }

            const running = part.state === 'input-streaming'
              || part.state === 'input-available'
              || part.state === 'approval-requested'
            const failed = part.state === 'output-error' || part.state === 'output-denied'
            const payload = 'output' in part && part.output !== undefined
              ? part.output
              : 'input' in part
                ? part.input
                : undefined
            const payloadText = payload === undefined ? null : serializeChatActivity(payload)
            return (
              <View key={part.toolCallId} style={[styles.tool, { backgroundColor: theme.surfaceInset }]}>
                <View style={styles.activityHeading}>
                  {running
                    ? <ActivityIndicator color={theme.tertiaryForeground} size="small" />
                    : failed
                      ? <CircleAlert color={theme.destructive} size={15} />
                      : <Check color={theme.success} size={15} />}
                  <Wrench color={theme.tertiaryForeground} size={14} />
                  <Text style={[styles.activityTitle, { color: theme.foreground }]}>
                    {part.title ?? getToolName(part)}
                  </Text>
                </View>
                {payloadText && (
                  <Text selectable style={[styles.payload, { color: theme.mutedForeground }]}>{payloadText}</Text>
                )}
              </View>
            )
          })}

          {error && <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>}
          {!isLoading && !error && activities.length === 0 && (
            <Text style={[styles.empty, { color: theme.mutedForeground }]}>No activity details</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  activityHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  activityTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  content: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  empty: {
    fontSize: 13,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  error: {
    fontSize: 13,
    lineHeight: 19,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
  },
  payload: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  reasoning: {
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  reasoningText: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  safeArea: {
    flex: 1,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  tool: {
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
})
