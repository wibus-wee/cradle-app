import {
  Geist_400Regular,
} from '@expo-google-fonts/geist/400Regular'
import {
  Geist_500Medium,
} from '@expo-google-fonts/geist/500Medium'
import {
  Geist_600SemiBold,
} from '@expo-google-fonts/geist/600SemiBold'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ConnectionProvider } from '@/features/connection/connection-store'

export default function RootLayout() {
  const scheme = useColorScheme()
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
      },
    },
  }))
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
  })

  if (!fontsLoaded) {
    return null
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />
        </ConnectionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
