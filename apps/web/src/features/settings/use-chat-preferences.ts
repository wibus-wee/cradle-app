// Chat preferences query and mutation helpers for settings and continuation UI.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getPreferencesChatOptions, getPreferencesChatQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesChat } from '~/api-gen/sdk.gen'

export type ContinuationBehavior = 'queue' | 'steer'
export type TitleGenerationThinkingEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface TitleGenerationPreferences {
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: TitleGenerationThinkingEffort
}

export interface ChatPreferences {
  modelId: string | null
  configSelections: Record<string, unknown>
  continuationBehavior: ContinuationBehavior
  titleGeneration: TitleGenerationPreferences
}

type ChatPreferencesUpdate = Partial<Omit<ChatPreferences, 'titleGeneration'>> & {
  titleGeneration?: Partial<TitleGenerationPreferences>
}

const ChatPreferencesSchema = z.object({
  modelId: z.unknown().nullable().transform(value => typeof value === 'string' ? value : null),
  configSelections: z.record(z.string(), z.unknown()).default({}),
  continuationBehavior: z.enum(['queue', 'steer']).default('queue'),
  titleGeneration: z.object({
    providerTargetId: z.unknown().nullable().transform(value => typeof value === 'string' ? value : null),
    modelId: z.unknown().nullable().transform(value => typeof value === 'string' ? value : null),
    thinkingEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('minimal'),
  }).default({
    providerTargetId: null,
    modelId: null,
    thinkingEffort: 'minimal',
  }),
})

export const CHAT_PREFS_QUERY_KEY = getPreferencesChatQueryKey()

export function useChatPreferencesQuery() {
  return useQuery({
    ...getPreferencesChatOptions(),
    select: data => ChatPreferencesSchema.parse(data) satisfies ChatPreferences,
  })
}

export function useUpdateChatPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<ChatPreferences | null, Error, ChatPreferencesUpdate>({
    scope: { id: 'chat-preferences' },
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<ChatPreferences>(CHAT_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = {
        ...current,
        ...updates,
        titleGeneration: updates.titleGeneration
          ? { ...current.titleGeneration, ...updates.titleGeneration }
          : current.titleGeneration,
      }
      await putPreferencesChat({ body: next, throwOnError: true })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(CHAT_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useChatPreferences() {
  const { data: prefs, isLoading, isSuccess } = useChatPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateChatPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
