import type { ReactNode } from 'react'

import { SESSION_LIST_REFRESH_INTERVAL_MS } from '~/features/session/api/session-projection'
import { useNow } from '~/hooks/use-now'

import { WorkspaceSessionListNowContext } from './workspace-session-list-clock-context'

export function WorkspaceSessionListClock({ children }: { children: ReactNode }) {
  const nowMs = useNow(SESSION_LIST_REFRESH_INTERVAL_MS)

  return (
    <WorkspaceSessionListNowContext.Provider value={nowMs}>
      {children}
    </WorkspaceSessionListNowContext.Provider>
  )
}
