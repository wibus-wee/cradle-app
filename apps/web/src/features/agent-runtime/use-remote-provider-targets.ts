import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { GetProviderTargetsResponse } from '~/api-gen/types.gen'
import type { ProviderKind, ProviderTargetKind } from '~/features/agent-runtime/types'
import {
  fetchRemoteUpstreamJson,
  remoteHostUpstreamQueryKey,
} from '~/features/remote-hosts/upstream-fetch'

import type { ProviderTargetOption, UseProviderTargetsOptions } from './use-provider-targets'

export interface UseRemoteProviderTargetsOptions extends UseProviderTargetsOptions {
  hostId: string | null | undefined
  enabled?: boolean
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toProviderTargetOption(target: GetProviderTargetsResponse[number]): ProviderTargetOption {
  return {
    id: target.id,
    kind: target.kind as ProviderTargetKind,
    name: target.displayName,
    providerKind: target.providerKind as ProviderKind,
    enabled: target.enabled,
    iconSlug: nullableString(target.iconSlug),
    sourceKey: nullableString(target.sourceKey),
    externalRecordId: nullableString(target.externalRecordId),
  }
}

function buildProviderTargetsPath(options: UseProviderTargetsOptions): string {
  const params = new URLSearchParams()
  if (options.runtimeKind) {
    params.set('runtimeKind', options.runtimeKind)
  }
  if (options.workspaceId) {
    params.set('workspaceId', options.workspaceId)
  }
  const query = params.toString()
  return query ? `/provider-targets/?${query}` : '/provider-targets/'
}

export async function fetchRemoteProviderTargets(
  hostId: string,
  options: UseProviderTargetsOptions = {},
): Promise<GetProviderTargetsResponse> {
  return await fetchRemoteUpstreamJson<GetProviderTargetsResponse>(
    hostId,
    buildProviderTargetsPath(options),
  )
}

/**
 * Provider catalog for a remote Cradle Server host via the Upstream Gateway.
 * Used for new-chat on remote workspaces and for remote-execution sessions
 * whose model selector must not bind to local provider targets.
 */
export function useRemoteProviderTargets(options: UseRemoteProviderTargetsOptions) {
  const hostId = options.hostId ?? null
  const enabled = (options.enabled ?? true) && !!hostId
  const queryPath = buildProviderTargetsPath(options)
  const { data: providerTargets = [], isLoading, isSuccess, refetch } = useQuery({
    queryKey: remoteHostUpstreamQueryKey(
      hostId ?? '',
      'provider-targets',
      options.runtimeKind ?? '',
      options.workspaceId ?? '',
    ),
    queryFn: () => fetchRemoteProviderTargets(hostId!, options),
    enabled,
    staleTime: 30_000,
    retry: false,
  })

  const providerOptions = useMemo(
    () => providerTargets.map(target => toProviderTargetOption(target)),
    [providerTargets],
  )

  return {
    providerTargets,
    providerOptions,
    isLoading: enabled && isLoading,
    isSuccess,
    refetch,
    queryPath,
  }
}
