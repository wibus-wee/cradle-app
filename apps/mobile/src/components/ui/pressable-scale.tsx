import * as Haptics from 'expo-haptics'
import type { PropsWithChildren } from 'react'
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'

interface PressableScaleProps extends PressableProps {
  style?: StyleProp<ViewStyle>
  haptic?: boolean
}

export function PressableScale({
  children,
  style,
  haptic = false,
  onPress,
  ...props
}: PropsWithChildren<PressableScaleProps>) {
  return (
    <Pressable
      {...props}
      onPress={(event) => {
        if (haptic) {
          void Haptics.selectionAsync()
        }
        onPress?.(event)
      }}
      style={({ pressed }) => [
        style,
        { transform: [{ scale: pressed ? 0.96 : 1 }], opacity: pressed ? 0.88 : 1 },
      ]}
    >
      {children}
    </Pressable>
  )
}
