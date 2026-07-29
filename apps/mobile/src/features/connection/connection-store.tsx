import type { PropsWithChildren } from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { ServerConnection } from '@/lib/api'

import { ConnectionContext } from './connection-context'
import {
  clearStoredConnection,
  loadStoredConnection,
  persistConnection,
} from './connection-storage'

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [connection, setConnection] = useState<ServerConnection | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    let cancelled = false
    void loadStoredConnection()
      .catch(() => null)
      .then((storedConnection) => {
        if (!cancelled) {
          setConnection(storedConnection)
          setIsRestoring(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveConnection = useCallback(async (next: ServerConnection) => {
    await persistConnection(next)
    setConnection(next)
  }, [])

  const disconnect = useCallback(async () => {
    await clearStoredConnection()
    setConnection(null)
  }, [])

  const value = useMemo(() => ({
    connection,
    isRestoring,
    saveConnection,
    disconnect,
  }), [connection, disconnect, isRestoring, saveConnection])

  return <ConnectionContext value={value}>{children}</ConnectionContext>
}
