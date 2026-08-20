import { useEffect, useRef } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function useKeyboardOffset(enabled: boolean, lift = 0) {
  const insets = useSafeAreaInsets()
  const keyboardOffset = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!enabled) {
      keyboardOffset.setValue(0)
      return
    }

    const moveToKeyboard = (screenY: number, duration = 250) => {
      const overlap = Math.max(0, Dimensions.get('window').height - screenY - insets.bottom + lift)
      Animated.timing(keyboardOffset, {
        duration,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: -overlap,
        useNativeDriver: true,
      }).start()
    }

    const moveToRest = (duration = 250) => {
      Animated.timing(keyboardOffset, {
        duration,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: 0,
        useNativeDriver: true,
      }).start()
    }

    const metrics = Keyboard.metrics()
    if (metrics) {
      moveToKeyboard(metrics.screenY, 0)
    }

    const changeEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const change = Keyboard.addListener(changeEvent, (event) => {
      moveToKeyboard(event.endCoordinates.screenY, event.duration)
    })
    const hide = Keyboard.addListener(hideEvent, (event) => {
      moveToRest(event.duration)
    })

    return () => {
      change.remove()
      hide.remove()
    }
  }, [enabled, insets.bottom, keyboardOffset, lift])

  return keyboardOffset
}
