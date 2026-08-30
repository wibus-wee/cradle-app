import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ConnectionProvider } from '@/features/connection/connection-store'
import { AppLifecycleProvider } from '@/lib/app-lifecycle-provider'
import { useTheme } from '@/theme/use-theme'

export default function RootLayout() {
  const scheme = useColorScheme()
  const theme = useTheme()
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 10_000,
          },
        },
      }),
  )
  const [fontsLoaded] = useFonts({
    GeistMono_400Regular,
  })

  if (!fontsLoaded) {
    return null
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppLifecycleProvider queryClient={queryClient}>
          <ConnectionProvider>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: theme.surface },
                freezeOnBlur: true,
                headerBackButtonDisplayMode: 'minimal',
                headerShadowVisible: false,
                headerStyle: { backgroundColor: theme.surface },
                headerTintColor: theme.foreground,
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="connection/server" options={{ title: 'Server' }} />
              <Stack.Screen name="connection/token" options={{ title: 'Authentication' }} />
              <Stack.Screen name="workspace/[workspaceId]" options={{ title: 'Project' }} />
              <Stack.Screen name="workspace/[workspaceId]/files" options={{ title: 'Files' }} />
              <Stack.Screen
                name="work/[workId]"
                options={{ presentation: 'modal', title: 'Work info' }}
              />
              <Stack.Screen name="session/[sessionId]" options={{ title: 'Conversation' }} />
              <Stack.Screen name="usage" options={{ title: 'Usage' }} />
              <Stack.Screen
                name="pull-request/[owner]/[repo]/[number]"
                options={{ title: 'Pull request' }}
              />
            </Stack>
          </ConnectionProvider>
        </AppLifecycleProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
