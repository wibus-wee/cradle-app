import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteProfilesByIdMutation,
  getProfilesOptions,
  getProfilesQueryKey,
  getProviderTargetsQueryKey,
  putProfilesByIdMutation,
} from '~/api-gen/@tanstack/react-query.gen'

import type { AgentProfile } from './types'
import { AGENT_MODELS_QUERY_KEY } from './use-agent-models'
import { AGENTS_QUERY_KEY } from './use-agents'

const AGENT_PROFILES_QUERY_KEY = getProfilesQueryKey()
const EMPTY_AGENT_PROFILES: AgentProfile[] = []

export function useAgentProfiles() {
  const queryClient = useQueryClient()

  const { data: profiles = EMPTY_AGENT_PROFILES, isLoading, isSuccess, refetch } = useQuery({
    ...getProfilesOptions(),
  })

  const updateProfile = useMutation({
    ...putProfilesByIdMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
      ])
    },
  })

  const createProfile = useMutation({
    ...putProfilesByIdMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
      ])
    },
  })

  const removeProfile = useMutation({
    ...deleteProfilesByIdMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: AGENT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY }),
      ])
    },
  })

  return {
    profiles,
    isLoading,
    isSuccess,
    refetch,
    createProfile,
    updateProfile,
    removeProfile,
  }
}
