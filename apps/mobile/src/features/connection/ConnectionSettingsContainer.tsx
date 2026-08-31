import { useQueryClient } from '@tanstack/react-query'
import { Redirect, router, Stack } from 'expo-router'
import { Check } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import type { DirectServerConfig } from '@/lib/api'
import { testServerConnection } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createDirectServerConnection } from '@/lib/transport/direct-server-transport'
import { useTheme } from '@/theme/use-theme'

import { useConnection } from './connection-context'
import { normalizeServerUrl } from './connection-utils'
import type { ConnectionSetting } from './ConnectionSettingsView'
import { ConnectionSettingsView } from './ConnectionSettingsView'

interface ConnectionSettingsContainerProps {
  setting: ConnectionSetting
}

export function ConnectionSettingsContainer({ setting }: ConnectionSettingsContainerProps) {
  const { connection, saveConnection } = useConnection()
  const directConnection = connection?.kind === 'direct' ? connection : null
  const queryClient = useQueryClient()
  const theme = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [value, setValue] = useState(
    setting === 'server' ? directConnection?.url ?? '' : directConnection?.token ?? '',
  )

  const save = useCallback(() => {
    if (!directConnection) { return }
    setError(null)
    setIsSaving(true)
    let nextConnection: DirectServerConfig
    try {
      nextConnection = setting === 'server'
        ? { url: normalizeServerUrl(value), token: directConnection.token }
        : { url: directConnection.url, token: value.trim() || null }
    }
    catch {
      setError('Enter a valid Server URL.')
      setIsSaving(false)
      return
    }
    void testServerConnection(createDirectServerConnection(nextConnection))
      .then(async () => {
        queryClient.clear()
        await saveConnection(nextConnection)
        router.back()
      })
      .catch((cause: Error) => {
        setError(errorMessage(cause))
      })
      .finally(() => {
        setIsSaving(false)
      })
  }, [directConnection, queryClient, saveConnection, setting, value])
  const saveDisabled = isSaving || (setting === 'server' && !value.trim())

  if (!directConnection) {
    return <Redirect href="/" />
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => isSaving
            ? <ActivityIndicator color={theme.foreground} style={styles.headerAction} />
            : (
                <Pressable
                  accessibilityLabel="Save"
                  accessibilityRole="button"
                  disabled={saveDisabled}
                  hitSlop={8}
                  onPress={save}
                  style={styles.headerAction}
                >
                  <Check
                    color={saveDisabled ? theme.dimForeground : theme.foreground}
                    size={22}
                    strokeWidth={2.2}
                  />
                </Pressable>
              ),
        }}
      />
      <ConnectionSettingsView
        error={error}
        onChangeValue={setValue}
        setting={setting}
        value={value}
      />
    </>
  )
}

const styles = StyleSheet.create({
  headerAction: {
    alignItems: 'flex-end',
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
  },
})
