import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'

import { useFabric } from '@/features/fabric/fabric-context'
import { testServerConnection } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createDirectServerConnection } from '@/lib/transport/direct-server-transport'

import { useConnection } from './connection-context'
import { normalizeServerUrl } from './connection-utils'
import { DirectServerOnboardingView } from './DirectServerOnboardingView'
import { OnboardingView } from './OnboardingView'

export function OnboardingContainer() {
  const { saveConnection } = useConnection()
  const fabric = useFabric()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'fabric' | 'direct'>('fabric')
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
      await testServerConnection(createDirectServerConnection(connection))
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

  if (mode === 'direct') {
    return (
      <DirectServerOnboardingView
        error={error}
        isConnecting={isConnecting}
        onBack={() => {
          setError(null)
          setMode('fabric')
        }}
        onConnect={connect}
      />
    )
  }

  return (
    <OnboardingView
      membership={fabric.membership}
      pendingEnrollment={fabric.pendingEnrollment}
      enrollmentStatus={fabric.enrollmentStatus}
      membershipStatus={fabric.membershipStatus}
      error={error ?? fabric.error}
      onJoinFabric={(code) => {
        setError(null)
        void fabric.beginEnrollment(code).catch(cause => setError(errorMessage(cause as Error)))
      }}
      onCancelEnrollment={() => void fabric.cancelEnrollment()}
      onRefreshDirectory={() => void fabric.refreshDirectory().catch(() => {})}
      onSelectNode={nodeId => void fabric.selectNode(nodeId)}
      onUseDirectServer={() => {
        setError(null)
        setMode('direct')
      }}
      onLeaveFabric={() => void fabric.leaveFabric()}
    />
  )
}
