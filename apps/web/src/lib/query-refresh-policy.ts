// Shared React Query refresh policies for workspace data.

export type QueryRefreshPolicyName = 'static' | 'background' | 'active' | 'interactive'

export interface QueryRefreshPolicyOverrides {
  staleTime?: number
  refetchInterval?: number | false
}

export interface QueryRefreshPolicyOptions {
  staleTime: number
  refetchInterval: number | false
  refetchIntervalInBackground: true
  refetchOnWindowFocus: boolean | 'always'
  refetchOnReconnect: boolean | 'always'
}

const policyDefaults = {
  static: {
    staleTime: 300_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  },
  background: {
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
  active: {
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
  interactive: {
    staleTime: 3_000,
    refetchInterval: 5_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  },
} satisfies Record<QueryRefreshPolicyName, Omit<QueryRefreshPolicyOptions, 'refetchIntervalInBackground'>>

export function queryRefreshPolicy(
  name: QueryRefreshPolicyName,
  overrides: QueryRefreshPolicyOverrides = {},
): QueryRefreshPolicyOptions {
  const defaults = policyDefaults[name]

  return {
    ...defaults,
    staleTime: overrides.staleTime ?? defaults.staleTime,
    refetchInterval: overrides.refetchInterval ?? defaults.refetchInterval,
    refetchIntervalInBackground: true,
  }
}

export const queryRefreshPolicies = {
  static: queryRefreshPolicy('static'),
  background: queryRefreshPolicy('background'),
  active: queryRefreshPolicy('active'),
  interactive: queryRefreshPolicy('interactive'),
} satisfies Record<QueryRefreshPolicyName, QueryRefreshPolicyOptions>
