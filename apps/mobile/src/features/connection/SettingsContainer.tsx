import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import { testServerConnection } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { useConnection } from './connection-context'
import { normalizeServerUrl } from './connection-utils'
import { SettingsView } from './SettingsView'

export function SettingsContainer() {
  const { connection, disconnect, saveConnection } = useConnection()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  if (!connection) {
    router.replace('/')
    return null
  }

  return (
    <SettingsView
      error={error}
      isSaving={isSaving}
      onDisconnect={() => {
        queryClient.clear()
        void disconnect().then(() => router.replace('/'))
      }}
      onSave={(url, token) => {
        setError(null)
        setIsSaving(true)
        const nextConnection = {
          url: normalizeServerUrl(url),
          token: token.trim() || null,
        }
        void testServerConnection(nextConnection)
          .then(async () => {
            queryClient.clear()
            await saveConnection(nextConnection)
          })
          .catch((cause: Error) => {
            setError(errorMessage(cause))
          })
          .finally(() => {
            setIsSaving(false)
          })
      }}
      serverToken={connection.token ?? ''}
      serverUrl={connection.url}
    />
  )
}
