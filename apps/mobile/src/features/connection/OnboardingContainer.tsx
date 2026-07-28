import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import { testServerConnection } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

import { useConnection } from './connection-context'
import { normalizeServerUrl } from './connection-utils'
import { OnboardingView } from './OnboardingView'

export function OnboardingContainer() {
  const { saveConnection } = useConnection()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const connect = async (url: string, token: string) => {
    setError(null)
    setIsConnecting(true)
    try {
      const connection = {
        url: normalizeServerUrl(url),
        token: token.trim() || null,
      }
      await testServerConnection(connection)
      queryClient.clear()
      await saveConnection(connection)
      router.replace('/(tabs)/projects')
    }
    catch (cause) {
      setError(errorMessage(cause as Error))
    }
    finally {
      setIsConnecting(false)
    }
  }

  return <OnboardingView error={error} isConnecting={isConnecting} onConnect={connect} />
}
