import type { GetSessionAwaitsResponse } from '~/api-gen/types.gen'

import type {
  LiveAwaitStatus,
  UnsupportedLiveAwaitStatus,
} from './use-live-await-status'

export type SessionAwait = GetSessionAwaitsResponse[number]
export type SessionAwaitLiveStatus = LiveAwaitStatus | UnsupportedLiveAwaitStatus
export type SessionAwaitLiveStatusById = ReadonlyMap<
  string,
  SessionAwaitLiveStatus | undefined
>
