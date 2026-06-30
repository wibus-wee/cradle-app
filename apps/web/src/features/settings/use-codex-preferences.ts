// Codex preferences query and mutation helpers for settings-owned runtime defaults.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getPreferencesCodexOptions, getPreferencesCodexQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesCodex } from '~/api-gen/sdk.gen'

export interface CodexPreferences {
  useCradleUserAgent: boolean
}

const CodexPreferencesSchema = z.object({
  useCradleUserAgent: z.boolean().default(true),
})

export const CODEX_PREFS_QUERY_KEY = getPreferencesCodexQueryKey()

export function useCodexPreferencesQuery() {
  return useQuery({
    ...getPreferencesCodexOptions(),
    select: data => CodexPreferencesSchema.parse(data) satisfies CodexPreferences,
  })
}

export function useUpdateCodexPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<CodexPreferences | null, Error, Partial<CodexPreferences>>({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<CodexPreferences>(CODEX_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = { ...current, ...updates }
      await putPreferencesCodex({ body: next, throwOnError: true })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(CODEX_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useCodexPreferences() {
  const { data: prefs, isLoading, isSuccess } = useCodexPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateCodexPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
