import { useEffect } from 'react'

import type { LayoutSlots } from '~/components/layout/use-layout-slots'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { ChatSessionRouteContent } from '~/features/chat/session/chat-session-route-content'
import { workSurfaceId } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'

import { useWorkDetail } from './use-work'

const PENDING_WORK_LAYOUT_SLOTS = {
  aside: undefined,
  asideSessionId: null,
  asideWorkspaceId: null,
  panel: undefined,
  hasAside: false,
  hasPanel: false,
  hasBrowserPanel: false,
  headerActions: undefined,
} satisfies LayoutSlots

function PendingWorkLayoutSlots({ slotId }: { slotId: string }) {
  useRegisterLayoutSlots(slotId, PENDING_WORK_LAYOUT_SLOTS)
  return null
}

export function WorkPage({ workId }: { workId: string }) {
  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const workQuery = useWorkDetail(workId)

  useEffect(() => {
    if (!workQuery.data) {
      return
    }
    updateSurfaceTitle(workSurfaceId(workId), workQuery.data.work.title)
  }, [updateSurfaceTitle, workId, workQuery.data])

  if (workQuery.error) {
    throw workQuery.error
  }
  if (!workQuery.data) {
    return <PendingWorkLayoutSlots slotId={workSurfaceId(workId)} />
  }

  return (
    <ChatSessionRouteContent
      sessionId={workQuery.data.primaryThread.id}
      surfaceId={workSurfaceId(workId)}
      layoutSlotId={workSurfaceId(workId)}
    />
  )
}
