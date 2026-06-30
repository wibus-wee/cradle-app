import { postProvidersModels } from '~/api-gen/sdk.gen'
import type { ApiProviderKind } from '~/features/agent-runtime/types'

export interface ManualProviderModelCacheInput {
  id: string
  name: string
  providerKind: ApiProviderKind
  config: Record<string, unknown>
  credentialRef: string | null
}

export async function warmManualProviderModelCache(input: ManualProviderModelCacheInput): Promise<void> {
  await postProvidersModels({
    body: {
      providerKind: input.providerKind,
      label: input.name,
      config: input.config,
      secretRef: input.credentialRef,
      profileId: input.id,
      providerTargetKind: 'manual',
      providerTargetId: input.id,
    },
  })
}
