// Network preferences query and mutation helpers for Cradle-owned outbound requests.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { preferencesGateway } from './api/preferences'

export type NetworkProxyMode = 'system' | 'custom' | 'environment'
export type NetworkProxyStatusMode = NetworkProxyMode | 'off'
export type NetworkProxySource = 'none' | 'system' | 'custom' | 'environment'
export type NetworkInboundAccessMode = 'local' | 'network'
export type NetworkRelaySource = 'managed' | 'external'

export interface NetworkInboundPreferences {
  serverAccessMode: NetworkInboundAccessMode
  relaySource: NetworkRelaySource
  relayUrl: string | null
  managedRelayAccessMode: NetworkInboundAccessMode
  managedRelayPublicUrl: string | null
}

export interface NetworkPreferences {
  proxyEnabled: boolean
  proxyMode: NetworkProxyMode
  customProxyUrl: string | null
  inbound: NetworkInboundPreferences
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
  inbound: z.object({
    serverAccessMode: z.enum(['local', 'network']).default('local'),
    relaySource: z.enum(['managed', 'external']).default('managed'),
    relayUrl: z.string().nullable().default(null),
    managedRelayAccessMode: z.enum(['local', 'network']).default('network'),
    managedRelayPublicUrl: z.string().nullable().default(null),
  }).default({
    serverAccessMode: 'local',
    relaySource: 'managed',
    relayUrl: null,
    managedRelayAccessMode: 'network',
    managedRelayPublicUrl: null,
  }),
})

const NetworkProxyStatusSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['system', 'custom', 'environment', 'off']),
  source: z.enum(['none', 'system', 'custom', 'environment']),
  proxyUrl: z.string().nullable(),
  reason: z.string().nullable(),
  checkedAt: z.string(),
})

export const NETWORK_PREFS_QUERY_KEY = preferencesGateway.network.queryKey
export const NETWORK_PROXY_STATUS_QUERY_KEY = preferencesGateway.network.statusQueryKey

export function useNetworkPreferencesQuery() {
  return useQuery({
    ...preferencesGateway.network.queryOptions(),
    select: data => NetworkPreferencesSchema.parse(data) satisfies NetworkPreferences,
  })
}

export function useNetworkProxyStatusQuery() {
  return useQuery({
    ...preferencesGateway.network.statusQueryOptions(),
    select: data => NetworkProxyStatusSchema.parse(data) satisfies NetworkProxyStatus,
  })
}

export function useUpdateNetworkPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<NetworkPreferences | null, Error, Partial<NetworkPreferences>>({
    scope: { id: 'network-preferences' },
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<NetworkPreferences>(NETWORK_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = NetworkPreferencesSchema.parse({
        ...current,
        ...updates,
        inbound: updates.inbound
          ? { ...current.inbound, ...updates.inbound }
          : current.inbound,
      })
      await preferencesGateway.network.update(next)

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
