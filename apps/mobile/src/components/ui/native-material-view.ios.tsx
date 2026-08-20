import { requireNativeViewManager } from 'expo-modules-core'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

interface NativeMaterialViewProps extends ViewProps {
  glassStyle?: 'clear' | 'regular'
  style?: StyleProp<ViewStyle>
  tintColor?: string
}

const NativeMaterialViewComponent = requireNativeViewManager<NativeMaterialViewProps>('CradleMaterial')

export function NativeMaterialView(props: NativeMaterialViewProps) {
  return <NativeMaterialViewComponent {...props} />
}
