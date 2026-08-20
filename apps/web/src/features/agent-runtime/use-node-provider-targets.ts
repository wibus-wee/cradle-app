import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { GetProviderTargetsResponse } from '~/api-gen/types.gen'
import type { ProviderKind, ProviderTargetKind } from '~/features/agent-runtime/types'
import {
  fetchNodeUpstreamJson,
  nodeUpstreamQueryKey,
} from '~/features/nodes/upstream-fetch'

import type { ProviderTargetOption, UseProviderTargetsOptions } from './use-provider-targets'

export interface UseNodeProviderTargetsOptions extends UseProviderTargetsOptions {
  nodeId: string | null | undefined
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
    effectiveProviderKinds: target.effectiveProviderKinds as ProviderKind[],
    enabled: target.enabled,
    iconSlug: nullableString(target.iconSlug),
    enabledModelsJson: target.enabledModelsJson,
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

export async function fetchNodeProviderTargets(
  nodeId: string,
  options: UseProviderTargetsOptions = {},
): Promise<GetProviderTargetsResponse> {
  return await fetchNodeUpstreamJson<GetProviderTargetsResponse>(
    nodeId,
    buildProviderTargetsPath(options),
  )
}

/**
 * Provider catalog for a Fabric Node via the Upstream Gateway.
 * Used for new-chat on node-execution workspaces and for node-execution sessions
 * whose model selector must not bind to local provider targets.
 */
export function useNodeProviderTargets(options: UseNodeProviderTargetsOptions) {
  const nodeId = options.nodeId ?? null
  const enabled = (options.enabled ?? true) && !!nodeId
  const queryPath = buildProviderTargetsPath(options)
  const { data: providerTargets = [], isLoading, isSuccess, refetch } = useQuery({
    queryKey: nodeUpstreamQueryKey(
      nodeId ?? '',
      'provider-targets',
      options.runtimeKind ?? '',
      options.workspaceId ?? '',
    ),
    queryFn: () => fetchNodeProviderTargets(nodeId!, options),
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
