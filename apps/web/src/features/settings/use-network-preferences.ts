// Network preferences query and mutation helpers for Cradle-owned outbound requests.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  getPreferencesNetworkOptions,
  getPreferencesNetworkQueryKey,
  getPreferencesNetworkStatusOptions,
  getPreferencesNetworkStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesNetwork } from '~/api-gen/sdk.gen'

export type NetworkProxyMode = 'system' | 'custom' | 'environment'
export type NetworkProxyStatusMode = NetworkProxyMode | 'off'
export type NetworkProxySource = 'none' | 'system' | 'custom' | 'environment'

export interface NetworkPreferences {
  proxyEnabled: boolean
  proxyMode: NetworkProxyMode
  customProxyUrl: string | null
}

export interface NetworkProxyStatus {
  enabled: boolean
  mode: NetworkProxyStatusMode
  source: NetworkProxySource
  proxyUrl: string | null
  reason: string | null
  checkedAt: string
}

const NetworkPreferencesSchema = z.object({
  proxyEnabled: z.boolean().default(true),
  proxyMode: z.enum(['system', 'custom', 'environment']).default('system'),
  customProxyUrl: z.string().nullable().default(null),
})

const NetworkProxyStatusSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['system', 'custom', 'environment', 'off']),
  source: z.enum(['none', 'system', 'custom', 'environment']),
  proxyUrl: z.string().nullable(),
  reason: z.string().nullable(),
  checkedAt: z.string(),
})

export const NETWORK_PREFS_QUERY_KEY = getPreferencesNetworkQueryKey()
export const NETWORK_PROXY_STATUS_QUERY_KEY = getPreferencesNetworkStatusQueryKey()

export function useNetworkPreferencesQuery() {
  return useQuery({
    ...getPreferencesNetworkOptions(),
    select: data => NetworkPreferencesSchema.parse(data) satisfies NetworkPreferences,
  })
}

export function useNetworkProxyStatusQuery() {
  return useQuery({
    ...getPreferencesNetworkStatusOptions(),
    select: data => NetworkProxyStatusSchema.parse(data) satisfies NetworkProxyStatus,
  })
}

export function useUpdateNetworkPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<NetworkPreferences | null, Error, Partial<NetworkPreferences>>({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<NetworkPreferences>(NETWORK_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = NetworkPreferencesSchema.parse({ ...current, ...updates })
      await putPreferencesNetwork({ body: next, throwOnError: true })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(NETWORK_PREFS_QUERY_KEY, updated)
        void queryClient.invalidateQueries({ queryKey: NETWORK_PROXY_STATUS_QUERY_KEY })
      }
    },
  })
}

export function useNetworkPreferences() {
  const { data: prefs, isLoading, isSuccess } = useNetworkPreferencesQuery()
  const { data: status, isLoading: isStatusLoading, refetch: refetchStatus } = useNetworkProxyStatusQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateNetworkPreferencesMutation()

  return {
    prefs: prefs ?? null,
    status: status ?? null,
    isLoading,
    isStatusLoading,
    isSuccess,
    savePrefs,
    isSaving,
    refetchStatus,
  }
}
