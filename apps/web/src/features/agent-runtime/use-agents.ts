import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteAgentsByIdMutation,
  getAgentsOptions,
  getAgentsQueryKey,
  getProviderTargetsQueryKey,
  patchAgentsByIdMutation,
  postAgentsImportLocalConfigMutation,
  postAgentsImportLocalConfigPreviewMutation,
  postAgentsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetAgentsResponse,
  PatchAgentsByIdData,
  PostAgentsData,
  PostAgentsImportLocalConfigPreviewResponse,
  PostAgentsImportLocalConfigResponse,
} from '~/api-gen/types.gen'

export const AGENTS_QUERY_KEY = getAgentsQueryKey()

type AgentResponse = GetAgentsResponse[number]

export type Agent = AgentResponse
export type CreateAgentInput = PostAgentsData['body']
export type UpdateAgentInput = PatchAgentsByIdData['body']
export type PreviewLocalConfigImportResult = PostAgentsImportLocalConfigPreviewResponse
export type ImportLocalConfigResult = PostAgentsImportLocalConfigResponse

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeAgent(agent: AgentResponse): Agent {
  return {
    id: agent.id,
    name: agent.name,
    description: nullableString(agent.description),
    avatarUrl: nullableString(agent.avatarUrl),
    avatarStyle: agent.avatarStyle,
    avatarSeed: agent.avatarSeed,
    providerTargetId: nullableString(agent.providerTargetId),
    modelId: nullableString(agent.modelId),
    thinkingEffort: agent.thinkingEffort,
    runtimeKind: agent.runtimeKind,
    configJson: agent.configJson,
    enabled: agent.enabled,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  }
}

export function useAgents() {
  const queryClient = useQueryClient()

  const { data: agentResponses = [], isLoading, isSuccess } = useQuery({
    ...getAgentsOptions(),
  })
  const agents = agentResponses.map(normalizeAgent)

  const createAgent = useMutation({
    ...postAgentsMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const importLocalConfig = useMutation({
    ...postAgentsImportLocalConfigMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
    },
  })

  const previewLocalConfigImport = useMutation({
    ...postAgentsImportLocalConfigPreviewMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
    },
  })

  const updateAgent = useMutation({
    ...patchAgentsByIdMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  const removeAgent = useMutation({
    ...deleteAgentsByIdMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY })
    },
  })

  return {
    agents,
    isLoading,
    isSuccess,
    createAgent,
    importLocalConfig,
    previewLocalConfigImport,
    updateAgent,
    removeAgent,
  }
}
