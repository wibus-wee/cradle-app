import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { DEFAULT_CLAUDE_AGENT_ALIASES } from '~/features/agent-runtime/claude-agent-config'
import type { RuntimeKind } from '~/features/agent-runtime/types'

import type { RuntimeSettings } from '../commands/chat-response-command'
import type {
  ChatRuntimeSettingsResponse,
  SessionClaudeAgentConfig,
  SessionRuntimeSettingsPatch,
} from '../commands/runtime-settings-command'
import {
  getSessionRuntimeSettings,
  runtimeSettingsQueryKey,
  updateSessionRuntimeSettings,
} from '../commands/runtime-settings-command'

export interface ChatRuntimeSettingsState {
  runtimeKind: RuntimeKind | null
  settings: RuntimeSettings
  claudeAgent: SessionClaudeAgentConfig | null
  applied: boolean
  loaded: boolean
  loading: boolean
  saving: boolean
  update: (patch: SessionRuntimeSettingsPatch) => Promise<ChatRuntimeSettingsResponse | null>
}

export function useRuntimeSettings(sessionId: string | null, active = true): ChatRuntimeSettingsState {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: runtimeSettingsQueryKey(sessionId),
    queryFn: () => getSessionRuntimeSettings(sessionId!),
    enabled: active && !!sessionId,
    staleTime: 10_000,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: (patch: SessionRuntimeSettingsPatch) => updateSessionRuntimeSettings({
      sessionId: sessionId!,
      patch,
    }),
    onMutate: async (patch) => {
      const currentSessionId = sessionId!
      const queryKey = runtimeSettingsQueryKey(currentSessionId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ChatRuntimeSettingsResponse>(queryKey)
      const { claudeAgent, ...runtimeSettingsPatch } = patch
      const optimisticClaudeAgent = Object.hasOwn(patch, 'claudeAgent')
        ? claudeAgent?.modelAliases
          ? {
              modelAliases: {
                ...DEFAULT_CLAUDE_AGENT_ALIASES,
                ...claudeAgent.modelAliases,
              },
            }
          : null
        : previous?.claudeAgent ?? null
      const optimisticRuntimeSettings: RuntimeSettings = { ...(previous?.runtimeSettings ?? {}) }
      for (const [key, value] of Object.entries(runtimeSettingsPatch)) {
        if (value === undefined || (value !== null && typeof value === 'object')) {
          continue
        }
        if (value === null) {
          delete optimisticRuntimeSettings[key]
          continue
        }
        optimisticRuntimeSettings[key] = value
      }
      queryClient.setQueryData<ChatRuntimeSettingsResponse>(queryKey, {
        sessionId: currentSessionId,
        runtimeKind: previous?.runtimeKind ?? 'standard',
        runtimeSettings: optimisticRuntimeSettings,
        claudeAgent: optimisticClaudeAgent,
        applied: false,
      })
      return { previous, queryKey }
    },
    onError: (_error, _patch, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
    },
    onSuccess: (response) => {
      queryClient.setQueryData(runtimeSettingsQueryKey(response.sessionId), response)
      void queryClient.invalidateQueries({ queryKey: ['chat', 'runtime-session-status', response.sessionId] })
    },
  })

  return {
    runtimeKind: query.data?.runtimeKind ?? null,
    settings: query.data?.runtimeSettings ?? {},
    claudeAgent: query.data?.claudeAgent ?? null,
    applied: query.data?.applied ?? false,
    loaded: Boolean(query.data),
    loading: query.isLoading,
    saving: mutation.isPending,
    update: async (patch) => {
      if (!sessionId) {
        return null
      }
      return await mutation.mutateAsync(patch)
    },
  }
}
