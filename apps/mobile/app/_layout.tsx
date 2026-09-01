import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFonts } from 'expo-font'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ConnectionProvider } from '@/features/connection/connection-store'
import { FabricProvider } from '@/features/fabric/fabric-provider'
import { AppLifecycleProvider } from '@/lib/app-lifecycle-provider'
import { MotionPreferenceProvider } from '@/lib/motion-preference-provider'
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

  const navigationTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.surface,
      border: theme.chromeBorder,
      card: theme.chrome,
      notification: theme.destructive,
      primary: theme.info,
      text: theme.foreground,
    },
  }

  return (
    <SafeAreaProvider>
      <MotionPreferenceProvider>
        <QueryClientProvider client={queryClient}>
          <AppLifecycleProvider queryClient={queryClient}>
            <FabricProvider>
              <ConnectionProvider>
                <ThemeProvider value={navigationTheme}>
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
                </ThemeProvider>
              </ConnectionProvider>
            </FabricProvider>
          </AppLifecycleProvider>
        </QueryClientProvider>
      </MotionPreferenceProvider>
    </SafeAreaProvider>
  )
}
