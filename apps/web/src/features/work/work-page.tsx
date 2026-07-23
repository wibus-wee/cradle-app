import { useEffect } from 'react'

import { Spinner } from '~/components/ui/spinner'
import { ChatSessionRouteContent } from '~/features/chat/session/chat-session-route-content'
import { workSurfaceId } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'

import { useWorkDetail } from './use-work'

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
    return (
      <div className="flex h-full items-center justify-center" data-testid="work-page-loading">
        <Spinner className="size-4" />
      </div>
    )
  }

  return (
    <ChatSessionRouteContent
      sessionId={workQuery.data.primaryThread.id}
      surfaceId={workSurfaceId(workId)}
      layoutSlotId={workSurfaceId(workId)}
    />
  )
}
