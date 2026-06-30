// Desktop preferences query and mutation helpers for Electron-owned runtime behavior.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getPreferencesDesktopOptions, getPreferencesDesktopQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesDesktop } from '~/api-gen/sdk.gen'
import type { MacInputBareModifier } from '~/lib/electron'

export interface DesktopPreferences {
  requireDoubleCommandQToQuit: boolean
  appshotHotkeyEnabled: boolean
  appshotHotkeyTrigger: MacInputBareModifier
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
  lastSeenChangelogVersion: string | null
}

const DesktopPreferencesSchema = z.object({
  requireDoubleCommandQToQuit: z.boolean().default(true),
  appshotHotkeyEnabled: z.boolean().default(true),
  appshotHotkeyTrigger: z.enum(['DoubleCommand', 'DoubleOption', 'DoubleShift']).default('DoubleCommand'),
  autoCheckForUpdates: z.boolean().default(true),
  autoDownloadUpdates: z.boolean().default(false),
  lastSeenChangelogVersion: z.string().nullable().default(null),
})

export const DESKTOP_PREFS_QUERY_KEY = getPreferencesDesktopQueryKey()

export function useDesktopPreferencesQuery() {
  return useQuery({
    ...getPreferencesDesktopOptions(),
    select: data => DesktopPreferencesSchema.parse(data) satisfies DesktopPreferences,
  })
}

export function useUpdateDesktopPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<DesktopPreferences | null, Error, Partial<DesktopPreferences>>({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<DesktopPreferences>(DESKTOP_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = { ...current, ...updates }
      await putPreferencesDesktop({ body: next, throwOnError: true })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(DESKTOP_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useDesktopPreferences() {
  const { data: prefs, isLoading, isSuccess } = useDesktopPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateDesktopPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
