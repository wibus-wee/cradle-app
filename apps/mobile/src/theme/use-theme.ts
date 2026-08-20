import { useColorScheme } from 'react-native'

import { getTheme } from './tokens'

export function useTheme() {
  return getTheme(useColorScheme())
}
