import { View } from 'react-native'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

export interface NativeMaterialViewProps extends ViewProps {
  glassStyle?: 'clear' | 'regular'
  isInteractive?: boolean
  style?: StyleProp<ViewStyle>
  tintColor?: string
}

export function NativeMaterialView({
  glassStyle: _glassStyle,
  isInteractive: _isInteractive,
  style,
  tintColor: _tintColor,
  ...props
}: NativeMaterialViewProps) {
  return <View {...props} style={style} />
}
