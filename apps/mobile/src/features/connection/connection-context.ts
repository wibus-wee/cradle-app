import { createContext, useContext } from 'react'

import type { CradleConnection, DirectServerConfig } from '@/lib/api'

export interface ConnectionContextValue {
  connection: CradleConnection | null
  isRestoring: boolean
  saveConnection: (connection: DirectServerConfig) => Promise<void>
  disconnect: () => Promise<void>
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext)
  if (!context) {
    throw new Error('useConnection must be used within ConnectionProvider')
  }
  return context
}
