import { GlassView } from 'expo-glass-effect'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

interface NativeMaterialViewProps extends ViewProps {
  glassStyle?: 'clear' | 'regular'
  isInteractive?: boolean
  style?: StyleProp<ViewStyle>
  tintColor?: string
}

export function NativeMaterialView({ glassStyle = 'regular', ...props }: NativeMaterialViewProps) {
  return <GlassView {...props} glassEffectStyle={glassStyle} />
}
