import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getSecrets } from '~/api-gen/sdk.gen'

const CredentialMetadataSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  maskedSecret: z.string(),
  chatgpt: z.object({
    chatgptAccountId: z.string(),
    chatgptPlanType: z.string().nullable(),
    updatedAt: z.number(),
  }).nullable().optional(),
})

const CredentialMetadataListSchema = z.array(CredentialMetadataSchema)

export type CredentialMetadata = z.infer<typeof CredentialMetadataSchema>

export function isChatgptCredentialMetadata(credential: CredentialMetadata | null | undefined): boolean {
  return credential?.kind === 'chatgpt-auth' || !!credential?.chatgpt
}

export function useCredentialMetadata(credentialRef: string | null | undefined) {
  return useQuery({
    queryKey: ['secrets', 'metadata', credentialRef ?? 'none'],
    queryFn: async () => {
      const { data } = await getSecrets({ throwOnError: true })
      const secrets = CredentialMetadataListSchema.parse(data)
      return secrets.find(secret => secret.id === credentialRef) ?? null
    },
    enabled: !!credentialRef,
    staleTime: 30_000,
  })
}
