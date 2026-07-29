import { Image, StyleSheet } from 'react-native'

import { PressableScale } from '@/components/ui/pressable-scale'

import cradleIcon from '../../../assets/icon.png'

interface CradleIconButtonProps {
  onPress: () => void
}

export function CradleIconButton({ onPress }: CradleIconButtonProps) {
  return (
    <PressableScale
      accessibilityLabel="Open Usage"
      accessibilityRole="button"
      haptic
      onPress={onPress}
      style={styles.button}
    >
      <Image source={cradleIcon} style={styles.icon} />
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    height: 46,
    width: 46,
  },
  icon: {
    borderRadius: 12,
    height: 46,
    width: 46,
  },
})
