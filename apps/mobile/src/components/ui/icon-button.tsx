import type { LucideIcon } from 'lucide-react-native'
import { StyleSheet } from 'react-native'

import { useTheme } from '@/theme/use-theme'

import { PressableScale } from './pressable-scale'

interface IconButtonProps {
  accessibilityLabel: string
  icon: LucideIcon
  onPress: () => void
  tone?: 'default' | 'primary'
}

export function IconButton({
  accessibilityLabel,
  icon: Icon,
  onPress,
  tone = 'default',
}: IconButtonProps) {
  const theme = useTheme()
  const primary = tone === 'primary'

  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      haptic
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: primary ? theme.primary : theme.surface,
          borderColor: primary ? theme.primary : theme.input,
        },
      ]}
    >
      <Icon color={primary ? theme.primaryForeground : theme.foreground} size={20} strokeWidth={2} />
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
})
