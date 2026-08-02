import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'

import { getPreferencesJarvisOptions, getPreferencesJarvisQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesJarvis } from '~/api-gen/sdk.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'

import type { JarvisAmbientSessionPrefs } from './jarvis-ambient-session'

export interface JarvisPreferences {
  runtimeKind: RuntimeKind
  profileId: string | null
  model?: string
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

const JarvisPreferencesSchema = z.object({
  runtimeKind: z.string().min(1).default('jar-core'),
  profileId: z.string().nullable(),
  model: z.string().optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']),
})

export const JARVIS_PREFS_QUERY_KEY = getPreferencesJarvisQueryKey()

let jarvisPrefsSnapshot: JarvisAmbientSessionPrefs | null = null

export function readJarvisPrefsSnapshot(): JarvisAmbientSessionPrefs | null {
  return jarvisPrefsSnapshot
}

function syncJarvisPrefsSnapshot(prefs: JarvisPreferences | null | undefined): void {
  if (!prefs?.profileId) {
    jarvisPrefsSnapshot = null
    return
  }

  jarvisPrefsSnapshot = {
    runtimeKind: prefs.runtimeKind,
    profileId: prefs.profileId,
    modelId: prefs.model,
  }
}

export function useUpdateJarvisPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<JarvisPreferences | null, Error, Partial<JarvisPreferences>>({
    scope: { id: 'jarvis-preferences' },
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<JarvisPreferences>(JARVIS_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = { ...current, ...updates }
      await putPreferencesJarvis({
        body: next,
      })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(JARVIS_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useJarvisPreferences() {
  const { data: prefs, isLoading, isSuccess } = useQuery({
    ...getPreferencesJarvisOptions(),
    select: data => JarvisPreferencesSchema.parse(data) satisfies JarvisPreferences,
  })
  useEffect(() => {
    syncJarvisPrefsSnapshot(prefs)
  }, [prefs])
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateJarvisPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
