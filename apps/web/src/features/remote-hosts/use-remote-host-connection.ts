import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  getRemoteHostsOptions,
  getRemoteHostsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { postRemoteHostsByHostIdCradleServerConnect } from '~/api-gen/sdk.gen'
import type { GetRemoteHostsResponse } from '~/api-gen/types.gen'

export type RemoteHostRecord = GetRemoteHostsResponse[number]
export type RemoteHostConnectionState = RemoteHostRecord['connectionState']

export type RemoteHostConnectionGate
  = | { kind: 'local' }
    | { kind: 'unknown-host', hostId: string }
    | { kind: 'disconnected', hostId: string, host: RemoteHostRecord }
    | { kind: 'connected', hostId: string, host: RemoteHostRecord }

export function resolveRemoteHostConnectionGate(input: {
  hostId: string | null | undefined
  hosts: RemoteHostRecord[]
}): RemoteHostConnectionGate {
  if (!input.hostId) {
    return { kind: 'local' }
  }
  const host = input.hosts.find(candidate => candidate.id === input.hostId)
  if (!host) {
    return { kind: 'unknown-host', hostId: input.hostId }
  }
  if (host.connectionState === 'connected') {
    return { kind: 'connected', hostId: host.id, host }
  }
  return { kind: 'disconnected', hostId: host.id, host }
}

export function isRemoteHostConnectionBlocking(gate: RemoteHostConnectionGate): boolean {
  return gate.kind === 'disconnected' || gate.kind === 'unknown-host'
}

export function useRemoteHostsQuery(enabled = true) {
  return useQuery({
    ...getRemoteHostsOptions(),
    enabled,
    staleTime: 15_000,
  })
}

export function useRemoteHostConnection(hostId: string | null | undefined) {
  const query = useRemoteHostsQuery(!!hostId)
  const hosts = query.data ?? []
  const gate = useMemo(
    () => resolveRemoteHostConnectionGate({ hostId, hosts }),
    [hostId, hosts],
  )

  return {
    gate,
    host: gate.kind === 'connected' || gate.kind === 'disconnected' ? gate.host : null,
    isLoading: !!hostId && query.isLoading,
    isBlocking: isRemoteHostConnectionBlocking(gate),
    refetch: query.refetch,
  }
}

export function useConnectRemoteHost(hostId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!hostId) {
        throw new Error('Remote host id is required to connect.')
      }
      const { error } = await postRemoteHostsByHostIdCradleServerConnect({
        path: { hostId },
      })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getRemoteHostsQueryKey() })
    },
  })
}
