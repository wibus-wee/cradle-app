import {
  Image,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityHidden,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
} from '@expo/ui/swift-ui/modifiers'
import type { ComponentProps } from 'react'

interface NativeUnavailableViewProps {
  description: string
  systemImage: NonNullable<ComponentProps<typeof Image>['systemName']>
  title: string
}

const centeredText = multilineTextAlignment('center')
const contentFrame = frame({ maxWidth: Infinity, alignment: 'center' })
const contentPadding = padding({ bottom: 28, horizontal: 20, top: 28 })
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

export function NativeUnavailableView({
  description,
  systemImage,
  title,
}: NativeUnavailableViewProps) {
  return (
    <VStack
      alignment="center"
      modifiers={[contentFrame, contentPadding]}
      spacing={9}
    >
      <Image
        color="secondary"
        modifiers={[accessibilityHidden(true)]}
        size={32}
        systemName={systemImage}
      />
      <Text modifiers={[font({ textStyle: 'headline' }), centeredText]}>{title}</Text>
      <Text
        modifiers={[
          font({ textStyle: 'subheadline' }),
          secondaryForeground,
          centeredText,
          frame({ maxWidth: 320 }),
        ]}
      >
        {description}
      </Text>
    </VStack>
  )
}
