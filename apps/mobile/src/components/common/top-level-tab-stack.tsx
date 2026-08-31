import { Stack } from 'expo-router'
import { Platform } from 'react-native'

import { useTheme } from '@/theme/use-theme'

interface TopLevelTabStackProps {
  title: string
}

export function TopLevelTabStack({ title }: TopLevelTabStackProps) {
  const theme = useTheme()
  const isNative = Platform.OS !== 'web'

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: theme.surface },
        freezeOnBlur: true,
        headerBackButtonDisplayMode: 'minimal',
        headerLargeTitleEnabled: true,
        headerLargeTitleShadowVisible: false,
        headerLargeTitleStyle: { color: theme.foreground },
        headerShadowVisible: false,
        headerShown: isNative,
        headerTintColor: theme.foreground,
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  )
}
