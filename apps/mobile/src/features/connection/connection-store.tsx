import type { PropsWithChildren } from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { useFabric } from '@/features/fabric/fabric-context'
import type { CradleConnection, DirectServerConfig } from '@/lib/api'
import { createDirectServerConnection } from '@/lib/transport/direct-server-transport'

import { ConnectionContext } from './connection-context'
import {
  clearStoredConnection,
  loadStoredConnection,
  persistConnection,
} from './connection-storage'

export function ConnectionProvider({ children }: PropsWithChildren) {
  const fabric = useFabric()
  const [directConfig, setDirectConfig] = useState<DirectServerConfig | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    let cancelled = false
    void loadStoredConnection()
      .catch(() => null)
      .then((storedConnection) => {
        if (!cancelled) {
          setDirectConfig(storedConnection)
          setIsRestoring(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveConnection = useCallback(async (next: DirectServerConfig) => {
    await persistConnection(next)
    setDirectConfig(next)
  }, [])

  const disconnect = useCallback(async () => {
    await clearStoredConnection()
    setDirectConfig(null)
    if (fabric.membership) {
      await fabric.leaveFabric()
    }
  }, [fabric])

  const directConnection = useMemo(
    () => directConfig ? createDirectServerConnection(directConfig) : null,
    [directConfig],
  )
  const connection = useMemo<CradleConnection | null>(() => {
    const membership = fabric.membership
    const nodeId = membership?.selectedNodeId
    const node = membership?.directory.nodes.find(candidate => candidate.nodeId === nodeId)
    if (
      membership
      && nodeId
      && node
      && fabric.transport
      && ['active', 'offline'].includes(fabric.membershipStatus)
    ) {
      return {
        kind: 'fabric',
        resourceId: `fabric:${membership.fabricId}:node:${nodeId}`,
        displayName: node.displayName,
        fabricId: membership.fabricId,
        nodeId,
        relayUrl: membership.relayUrl,
        transport: fabric.transport,
      }
    }
    if (membership || fabric.pendingEnrollment) {
      return null
    }
    return directConnection
  }, [directConnection, fabric.membership, fabric.membershipStatus, fabric.pendingEnrollment, fabric.transport])

  const value = useMemo(() => ({
    connection,
    isRestoring,
    saveConnection,
    disconnect,
  }), [connection, disconnect, isRestoring, saveConnection])

  return <ConnectionContext value={value}>{children}</ConnectionContext>
}
