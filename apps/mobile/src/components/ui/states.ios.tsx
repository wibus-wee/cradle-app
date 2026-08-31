import {
  Button,
  Host,
  HStack,
  Image,
  ProgressView,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityHidden,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
} from '@expo/ui/swift-ui/modifiers'

import type { StateProps } from './states-contract'

const fullScreen = frame({ maxHeight: Infinity, maxWidth: Infinity })
const readableWidth = frame({ maxWidth: 320 })
const centeredText = multilineTextAlignment('center')
const horizontalPadding = padding({ horizontal: 32 })
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

function NativeState({
  actionLabel = 'Try Again',
  description,
  isActionPending = false,
  onAction,
  symbol,
  symbolColor,
  title,
}: StateProps & { symbol: 'exclamationmark.triangle.fill' | 'tray.fill', symbolColor: 'red' | 'secondary' }) {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack
        alignment="center"
        modifiers={[fullScreen, horizontalPadding]}
        spacing={10}
      >
        <Image
          color={symbolColor}
          modifiers={[accessibilityHidden(true)]}
          size={30}
          systemName={symbol}
        />
        <Text modifiers={[font({ textStyle: 'headline' }), centeredText, readableWidth]}>
          {title}
        </Text>
        {description && (
          <Text
            modifiers={[
              font({ textStyle: 'subheadline' }),
              secondaryForeground,
              centeredText,
              readableWidth,
            ]}
          >
            {description}
          </Text>
        )}
        {onAction && (
          <Button
            modifiers={[
              buttonStyle('borderedProminent'),
              disabled(isActionPending),
              frame({ minHeight: 44 }),
            ]}
            onPress={onAction}
          >
            <HStack spacing={8}>
              {isActionPending && <ProgressView />}
              <Text>{actionLabel}</Text>
            </HStack>
          </Button>
        )}
      </VStack>
    </Host>
  )
}

export function EmptyState({
  actionLabel,
  description,
  isActionPending,
  onAction,
  title,
}: StateProps) {
  return (
    <NativeState
      actionLabel={actionLabel}
      description={description}
      isActionPending={isActionPending}
      onAction={onAction}
      symbol="tray.fill"
      symbolColor="secondary"
      title={title}
    />
  )
}

export function ErrorState({
  actionLabel,
  description,
  isActionPending,
  onAction,
  title,
}: StateProps) {
  return (
    <NativeState
      actionLabel={actionLabel}
      description={description}
      isActionPending={isActionPending}
      onAction={onAction}
      symbol="exclamationmark.triangle.fill"
      symbolColor="red"
      title={title}
    />
  )
}

export function LoadingState() {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" modifiers={[fullScreen]} spacing={10}>
        <ProgressView />
        <Text modifiers={[font({ textStyle: 'subheadline' }), secondaryForeground]}>Loading</Text>
      </VStack>
    </Host>
  )
}
