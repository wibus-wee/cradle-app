/**
 * Output: opencode runtime-owned provider target projection.
 * Input: opencode native provider catalog and runtime target ids.
 * Position: opencode provider package owner for native provider target semantics.
 */

import type {
  RuntimeOwnedProviderTarget,
  RuntimeOwnedProviderTargets,
} from '../../chat-runtime/runtime-provider-types'
import type { ProviderKind } from '../../provider-contracts/types'
import {
  readOpenCodeRuntimeNativeProviderId,
} from './native-provider-target-id'

const OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_SOURCE_KEY = 'runtime-native:opencode'

export const OPENCODE_RUNTIME_OWNED_PROVIDER_TARGETS = {
  ownsProviderTargetId: providerTargetId => readOpenCodeRuntimeNativeProviderId(providerTargetId) !== null,
  projectProviderTarget: input => projectOpencodeRuntimeOwnedProviderTarget({
    providerTargetId: input.providerTargetId,
    now: input.now,
  }),
  listProviderTargets: async (input) => {
    const { listOpencodeRuntimeProviderGroups } = await import('./model-inventory')
    const groups = await listOpencodeRuntimeProviderGroups({
      runtimeKind: input.runtimeKind,
      workspacePath: input.workspacePath,
    })
    return groups.flatMap((group) => {
      const target = projectOpencodeRuntimeOwnedProviderTarget({
        providerTargetId: group.id,
        now: input.now,
        displayName: `OpenCode / ${group.label}`,
        providerKind: group.providerKind,
        externalRecordId: group.nativeProviderId,
      })
      return target ? [target] : []
    })
  },
  listModelsForProviderTarget: async (input) => {
    const { listOpencodeRuntimeModelsForProviderTarget } = await import('./model-inventory')
    return await listOpencodeRuntimeModelsForProviderTarget({
      runtimeKind: input.runtimeKind,
      providerTargetId: input.providerTargetId,
      workspacePath: input.workspacePath,
    })
  },
} satisfies RuntimeOwnedProviderTargets

function projectOpencodeRuntimeOwnedProviderTarget(input: {
  providerTargetId: string
  now: number
  displayName?: string
  providerKind?: ProviderKind
  externalRecordId?: string
}): RuntimeOwnedProviderTarget | null {
  const nativeProviderId = readOpenCodeRuntimeNativeProviderId(input.providerTargetId)
  if (!nativeProviderId) {
    return null
  }
  return {
    id: input.providerTargetId,
    kind: 'external',
    displayName: input.displayName ?? `OpenCode / ${nativeProviderId}`,
    providerKind: input.providerKind ?? 'universal',
    enabled: true,
    iconSlug: 'opencode',
    connectionConfigJson: '{}',
    credentialRef: null,
    enabledModelsJson: '[]',
    customModelsJson: '[]',
    sourceKey: OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_SOURCE_KEY,
    externalRecordId: input.externalRecordId ?? nativeProviderId,
    sourceFingerprint: input.providerTargetId,
    createdAt: input.now,
    updatedAt: input.now,
  }
}
