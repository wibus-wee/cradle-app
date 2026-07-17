// ACP registry + installed-agent query boundary for the Runtimes settings page
// and the agent-detail ACP binding picker.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { acpRegistryApi } from './api/acp-registry'

export const ACP_DISTRIBUTION_TYPES = ['npx', 'uvx', 'binary'] as const
export type AcpDistributionType = (typeof ACP_DISTRIBUTION_TYPES)[number]

const AcpRegistryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().nullable(),
  repository: z.string().nullish(),
  website: z.string().nullish(),
  authors: z.array(z.string()).optional(),
  license: z.string().nullish(),
  icon: z.string().nullish(),
  distribution: z.object({
    npx: z.unknown().optional(),
    uvx: z.unknown().optional(),
    binary: z.unknown().optional(),
  }),
})

const AcpInstalledAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().nullable(),
  distributionType: z.string().min(1),
  installPath: z.string().nullable(),
  cmd: z.string().nullable(),
  args: z.string().nullable(),
  env: z.string().nullable(),
  status: z.enum(['installing', 'installed', 'failed']),
})

export type AcpRegistryAgent = z.infer<typeof AcpRegistryAgentSchema>
export type AcpInstalledAgent = z.infer<typeof AcpInstalledAgentSchema>

const AcpRegistryResponseSchema = z.array(AcpRegistryAgentSchema)
const AcpAgentsResponseSchema = z.array(AcpInstalledAgentSchema)

export const ACP_REGISTRY_QUERY_KEY = acpRegistryApi.registryQueryKey()
export const ACP_AGENTS_QUERY_KEY = acpRegistryApi.agentsQueryKey()

/** Distribution types this registry entry can be installed with, preferred first. */
export function listAcpDistributionTypes(agent: AcpRegistryAgent): AcpDistributionType[] {
  return ACP_DISTRIBUTION_TYPES.filter(type => agent.distribution[type] != null)
}

export function useAcpRegistry() {
  const query = useQuery({
    ...acpRegistryApi.registryOptions(),
    select: data => AcpRegistryResponseSchema.parse(data),
    staleTime: 5 * 60_000,
  })

  return {
    ...query,
    registryAgents: query.data ?? [],
  }
}

export function useAcpAgents() {
  const query = useQuery({
    ...acpRegistryApi.agentsOptions(),
    select: data => AcpAgentsResponseSchema.parse(data),
  })

  return {
    ...query,
    installedAgents: query.data ?? [],
  }
}

export function useAcpAgentMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ACP_REGISTRY_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: ACP_AGENTS_QUERY_KEY })
  }

  const installAgent = useMutation({
    ...acpRegistryApi.installMutation(),
    onSettled: invalidate,
  })

  const cancelInstall = useMutation({
    ...acpRegistryApi.cancelInstallMutation(),
    onSettled: invalidate,
  })

  const uninstallAgent = useMutation({
    ...acpRegistryApi.uninstallMutation(),
    onSettled: invalidate,
  })

  return {
    installAgent,
    cancelInstall,
    uninstallAgent,
  }
}
