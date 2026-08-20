import { useQuery } from '@tanstack/react-query'

import { runtimeSessionStatusQueryOptions } from '../commands/runtime-session-status-command'

export {
  runtimeSessionStatusQueryKey,
  runtimeSessionStatusQueryOptions,
} from '../commands/runtime-session-status-command'

export interface RuntimeSessionStatusQueryOptions {
  refetchInterval?: number | false
  refetchWhileActiveInterval?: number | false
}

export function useRuntimeSessionStatus(
  sessionId: string | null,
  active = true,
  options: RuntimeSessionStatusQueryOptions = {},
) {
  const refetchInterval = options.refetchInterval ?? false
  const refetchWhileActiveInterval = options.refetchWhileActiveInterval ?? false

  return useQuery({
    ...runtimeSessionStatusQueryOptions(sessionId),
    enabled: active && !!sessionId,
    staleTime: 1_000,
    refetchInterval: (query) => {
      if (!active) {
        return false
      }
      if (refetchWhileActiveInterval && query.state.data?.activeRun) {
        return refetchWhileActiveInterval
      }
      return refetchInterval
    },
    refetchIntervalInBackground: true,
  })
}
