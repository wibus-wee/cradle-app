import type { ReactNode } from 'react'

import { useNow } from '~/hooks/use-now'

import { SESSION_LIST_REFRESH_INTERVAL_MS } from './use-session'
import { WorkspaceSessionListNowContext } from './workspace-session-list-clock-context'

export function WorkspaceSessionListClock({ children }: { children: ReactNode }) {
  const nowMs = useNow(SESSION_LIST_REFRESH_INTERVAL_MS)

  return (
    <WorkspaceSessionListNowContext.Provider value={nowMs}>
      {children}
    </WorkspaceSessionListNowContext.Provider>
  )
}
