import { BottomSheet } from '@expo/ui/community/bottom-sheet'
import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  textSelection,
} from '@expo/ui/swift-ui/modifiers'
import { getToolName, isReasoningUIPart } from 'ai'

import { NativeUnavailableView } from '@/components/ui/native-unavailable-view.ios'

import { chatActivityParts, serializeChatActivity } from './chat-activity-model'
import type { ChatActivitySheetProps } from './chat-activity-sheet-contract'

export type { ChatActivitySheetProps } from './chat-activity-sheet-contract'

const snapPoints = ['55%', '90%']
const fullWidth = frame({ maxWidth: Infinity, alignment: 'leading' })
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const minimumTapTarget = frame({ minHeight: 44, minWidth: 44 })

export function ChatActivitySheet({
  error = null,
  isLoading = false,
  message,
  onClose,
  visible,
}: ChatActivitySheetProps) {
  const activities = chatActivityParts(message)

  return (
    <BottomSheet
      enableDynamicSizing={false}
      enablePanDownToClose
      index={visible ? 0 : -1}
      onClose={onClose}
      snapPoints={snapPoints}
    >
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[listStyle('insetGrouped')]}>
          <Section>
            <HStack modifiers={[fullWidth]} spacing={12}>
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ textStyle: 'headline' })]}>Activity</Text>
                <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                  Tools and reasoning
                </Text>
              </VStack>
              <Spacer />
              <Button modifiers={[buttonStyle('plain'), minimumTapTarget]} onPress={onClose}>
                <Text modifiers={[foregroundStyle('blue')]}>Done</Text>
              </Button>
            </HStack>
          </Section>

          {isLoading && (
            <Section>
              <HStack spacing={10}>
                <ProgressView />
                <Text modifiers={[secondaryForeground]}>Loading activity…</Text>
              </HStack>
            </Section>
          )}

          {activities.map((part) => {
            if (isReasoningUIPart(part)) {
              return (
                <Section key={`reasoning-${part.text}`} title="Reasoning">
                  <HStack spacing={10}>
                    <Image color="secondary" size={17} systemName="brain.head.profile" />
                    <Text modifiers={[textSelection(true)]}>{part.text}</Text>
                  </HStack>
                </Section>
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
              <Section key={part.toolCallId} title={part.title ?? getToolName(part)}>
                <HStack spacing={10}>
                  {running
                    ? <ProgressView />
                    : (
                        <Image
                          color={failed ? 'red' : 'green'}
                          size={17}
                          systemName={failed ? 'exclamationmark.circle.fill' : 'checkmark.circle.fill'}
                        />
                      )}
                  <Image color="secondary" size={16} systemName="wrench.and.screwdriver" />
                  <Text modifiers={[secondaryForeground]}>
                    {running ? 'Running' : failed ? 'Failed' : 'Completed'}
                  </Text>
                </HStack>
                {payloadText && (
                  <Text
                    modifiers={[
                      font({ design: 'monospaced', textStyle: 'caption' }),
                      secondaryForeground,
                      textSelection(true),
                    ]}
                  >
                    {payloadText}
                  </Text>
                )}
              </Section>
            )
          })}

          {error && (
            <Section title="Error">
              <HStack spacing={10}>
                <Image color="red" size={17} systemName="exclamationmark.triangle.fill" />
                <Text modifiers={[foregroundStyle('red'), textSelection(true)]}>{error}</Text>
              </HStack>
            </Section>
          )}

          {!isLoading && !error && activities.length === 0 && (
            <NativeUnavailableView
              description="This message has no tool calls or reasoning details."
              systemImage="list.bullet.rectangle"
              title="No Activity"
            />
          )}
        </Form>
      </Host>
    </BottomSheet>
  )
}
