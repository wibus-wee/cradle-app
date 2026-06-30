import {
  getChatSessionsBySessionIdRuntimeStatusOptions,
  getChatSessionsBySessionIdRuntimeStatusQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetChatSessionsBySessionIdRuntimeStatusResponse } from '~/api-gen/types.gen'

const DISABLED_RUNTIME_STATUS_SESSION_ID = 'no-session'

export type RuntimeSessionStatus = GetChatSessionsBySessionIdRuntimeStatusResponse
export type RuntimeSessionStatusKind = RuntimeSessionStatus['status']
export type RuntimeSessionRunStatus = NonNullable<RuntimeSessionStatus['activeRun']>
export type RuntimeRunStatus = RuntimeSessionRunStatus['status']

export function runtimeSessionStatusQueryKey(sessionId: string | null): readonly unknown[] {
  return getChatSessionsBySessionIdRuntimeStatusQueryKey({
    path: { sessionId: sessionId ?? DISABLED_RUNTIME_STATUS_SESSION_ID },
  })
}

export function runtimeSessionStatusQueryOptions(sessionId: string | null) {
  return getChatSessionsBySessionIdRuntimeStatusOptions({
    path: { sessionId: sessionId ?? DISABLED_RUNTIME_STATUS_SESSION_ID },
  })
}
