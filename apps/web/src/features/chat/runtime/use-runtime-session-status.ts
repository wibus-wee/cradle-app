import { useQuery } from '@tanstack/react-query'
import { runtimeSessionStatusQueryOptions } from '../commands/runtime-session-status-command'

export {
  runtimeSessionStatusQueryKey,
  runtimeSessionStatusQueryOptions,
} from '../commands/runtime-session-status-command'

const RUNTIME_STATUS_REFETCH_INTERVAL_MS = 1_000

export function useRuntimeSessionStatus(sessionId: string | null, active = true) {
  return useQuery({
    ...runtimeSessionStatusQueryOptions(sessionId),
    enabled: active && !!sessionId,
    staleTime: 1_000,
    refetchInterval: active ? RUNTIME_STATUS_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: true,
  })
}
