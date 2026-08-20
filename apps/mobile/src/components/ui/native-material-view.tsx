import { View } from 'react-native'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

export interface NativeMaterialViewProps extends ViewProps {
  glassStyle?: 'clear' | 'regular'
  style?: StyleProp<ViewStyle>
  tintColor?: string
}

export function NativeMaterialView({ style, ...props }: NativeMaterialViewProps) {
  return <View {...props} style={style} />
}
