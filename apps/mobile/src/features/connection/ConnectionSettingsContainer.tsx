import { useQueryClient } from '@tanstack/react-query'
import { Redirect, router, Stack } from 'expo-router'
import { Check } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet } from 'react-native'

import type { ServerConnection } from '@/lib/api'
import { testServerConnection } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { useTheme } from '@/theme/use-theme'

import { useConnection } from './connection-context'
import type { ConnectionSetting } from './connection-settings-view-contract'
import { normalizeServerUrl } from './connection-utils'
import { ConnectionSettingsView } from './ConnectionSettingsView'

interface ConnectionSettingsContainerProps {
  setting: ConnectionSetting
}

export function ConnectionSettingsContainer({ setting }: ConnectionSettingsContainerProps) {
  const { connection, saveConnection } = useConnection()
  const queryClient = useQueryClient()
  const theme = useTheme()
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [value, setValue] = useState(
    setting === 'server' ? connection?.url ?? '' : connection?.token ?? '',
  )

  const save = useCallback(() => {
    if (!connection) { return }
    setError(null)
    setIsSaving(true)
    let nextConnection: ServerConnection
    try {
      nextConnection = setting === 'server'
        ? { url: normalizeServerUrl(value), token: connection.token }
        : { url: connection.url, token: value.trim() || null }
    }
    catch {
      setError('Enter a valid Server URL.')
      setIsSaving(false)
      return
    }
    void testServerConnection(nextConnection)
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
  }, [connection, queryClient, saveConnection, setting, value])
  const saveDisabled = isSaving || (setting === 'server' && !value.trim())
  const submit = () => {
    if (!saveDisabled) {
      save()
    }
  }

  if (!connection) {
    return <Redirect href="/" />
  }

  return (
    <>
      {Platform.OS === 'ios'
        ? (
            <Stack.Toolbar placement="right">
              <Stack.Toolbar.Button
                accessibilityHint="Checks and saves this connection setting"
                accessibilityLabel="Save connection setting"
                disabled={saveDisabled}
                onPress={submit}
                variant="done"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </Stack.Toolbar.Button>
            </Stack.Toolbar>
          )
        : (
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
          )}
      <ConnectionSettingsView
        error={error}
        onChangeValue={setValue}
        onSubmit={submit}
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
