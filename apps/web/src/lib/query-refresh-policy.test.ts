import { describe, expect, it } from 'vitest'

import { queryRefreshPolicies, queryRefreshPolicy } from './query-refresh-policy'

describe('queryRefreshPolicy', () => {
  it('keeps workspace polling enabled while a window is in the background', () => {
    expect(queryRefreshPolicy('active')).toEqual(expect.objectContaining({
      refetchIntervalInBackground: true,
      refetchInterval: 15_000,
    }))
  })

  it('uses frequent refresh for interactive data', () => {
    expect(queryRefreshPolicies.interactive).toEqual({
      staleTime: 3_000,
      refetchInterval: 5_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
    })
  })

  it('allows focused hooks to override timing without changing focus behavior', () => {
    expect(queryRefreshPolicy('interactive', { staleTime: 1_000, refetchInterval: 20_000 })).toEqual({
      staleTime: 1_000,
      refetchInterval: 20_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
    })
  })

  it('keeps static data out of polling', () => {
    expect(queryRefreshPolicies.static.refetchInterval).toBe(false)
    expect(queryRefreshPolicies.static.refetchOnWindowFocus).toBe(false)
  })
})
