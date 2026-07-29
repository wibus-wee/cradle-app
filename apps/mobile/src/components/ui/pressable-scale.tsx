import * as Haptics from 'expo-haptics'
import type { PropsWithChildren } from 'react'
import { useRef, useState } from 'react'
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'

interface PressableScaleProps extends PressableProps {
  style?: StyleProp<ViewStyle>
  haptic?: boolean
}

export function PressableScale({
  children,
  style,
  haptic = false,
  onPress,
  onPressIn,
  onPressOut,
  ...props
}: PropsWithChildren<PressableScaleProps>) {
  const scale = useRef(new Animated.Value(1)).current
  const [pressed, setPressed] = useState(false)
  const springTo = (value: number) => {
    Animated.spring(scale, {
      damping: 40,
      mass: 1,
      stiffness: 600,
      toValue: value,
      useNativeDriver: true,
    }).start()
  }

  return (
    <AnimatedPressable
      {...props}
      onPress={(event) => {
        if (haptic) {
          void Haptics.selectionAsync()
        }
        onPress?.(event)
      }}
      onPressIn={(event) => {
        setPressed(true)
        springTo(0.96)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        setPressed(false)
        springTo(1)
        onPressOut?.(event)
      }}
      style={[
        style,
        { opacity: pressed ? 0.88 : 1, transform: [{ scale }] },
      ]}
    >
      {children}
    </AnimatedPressable>
  )
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
