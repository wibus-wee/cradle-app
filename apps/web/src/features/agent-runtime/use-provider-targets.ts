import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getProviderTargetsOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetProviderTargetsResponse } from '~/api-gen/types.gen'
import type { ProviderKind, ProviderTargetKind } from '~/features/agent-runtime/types'

export type ProviderTargetRecord = GetProviderTargetsResponse[number]

export interface UseProviderTargetsOptions {
  runtimeKind?: string | null
  workspaceId?: string | null
  enabled?: boolean
}

export interface ProviderTargetOption {
  id: string
  kind: ProviderTargetKind
  name: string
  providerKind: ProviderKind
  effectiveProviderKinds: ProviderKind[]
  enabled: boolean
  iconSlug: string | null
  enabledModelsJson?: string
  sourceKey: string | null
  externalRecordId: string | null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toProviderTargetOption(target: ProviderTargetRecord): ProviderTargetOption {
  return {
    id: target.id,
    kind: target.kind,
    name: target.displayName,
    providerKind: target.providerKind,
    effectiveProviderKinds: target.effectiveProviderKinds,
    enabled: target.enabled,
    iconSlug: nullableString(target.iconSlug),
    enabledModelsJson: target.enabledModelsJson,
    sourceKey: nullableString(target.sourceKey),
    externalRecordId: nullableString(target.externalRecordId),
  }
}

export function useProviderTargets(options: UseProviderTargetsOptions = {}) {
  const query = {
    runtimeKind: options.runtimeKind ?? undefined,
    workspaceId: options.workspaceId ?? undefined,
  }
  const { data: providerTargets = [], isLoading, isSuccess, refetch } = useQuery({
    ...getProviderTargetsOptions({ query }),
    enabled: options.enabled ?? true,
  })

  const providerOptions = useMemo(
    () => providerTargets.map(target => toProviderTargetOption(target)),
    [providerTargets],
  )

  return {
    providerTargets,
    providerOptions,
    isLoading,
    isSuccess,
    refetch,
  }
}
