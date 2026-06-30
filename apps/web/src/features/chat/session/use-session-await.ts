import { useQuery } from '@tanstack/react-query'

import { getSessionAwaitsSummaryOptions } from '~/api-gen/@tanstack/react-query.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

export function useSessionAwaitSummary(sessionId: string | null, active = true) {
  return useQuery({
    ...getSessionAwaitsSummaryOptions({ query: { sessionId: sessionId ?? '' } }),
    ...queryRefreshPolicies.interactive,
    refetchInterval: query => query.state.data?.awaiting ? 1_000 : queryRefreshPolicies.interactive.refetchInterval,
    enabled: active && !!sessionId,
  })
}
