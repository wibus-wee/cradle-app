import { router, Stack } from 'expo-router'
import type { PropsWithChildren } from 'react'
import { Platform } from 'react-native'

export function TopLevelTabPage({ children }: PropsWithChildren) {
  return (
    <>
      {Platform.OS !== 'web' && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityHint="Shows token and cost activity"
            accessibilityLabel="Open Usage"
            onPress={() => router.push('/usage')}
          >
            {Platform.OS === 'ios'
              ? (
                  <>
                    <Stack.Toolbar.Icon sf="chart.bar.xaxis" />
                    <Stack.Toolbar.Label>Usage</Stack.Toolbar.Label>
                  </>
                )
              : 'Usage'}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      {children}
    </>
  )
}
