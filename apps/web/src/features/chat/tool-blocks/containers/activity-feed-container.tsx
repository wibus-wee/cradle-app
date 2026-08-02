import { useCallback } from 'react'

import { useBrowserPanelStore } from '~/store/browser-panel'

import type { ActivityFeedViewProps } from '../views/activity-feed-view'
import { ActivityFeedView } from '../views/activity-feed-view'
import type { ArtifactOpenInput } from '../views/artifact-preview-view'
import type { PlanDocumentOpenInput } from '../views/plan-document-preview-view'

export interface ActivityFeedProps extends Omit<
  ActivityFeedViewProps,
  'onOpenWorkspaceDiff' | 'onOpenPlanDocument' | 'onOpenArtifact'
> {
  sessionId?: string | null
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
}

/** Runtime adapter that connects the props-only activity feed to browser-panel state. */
export function ActivityFeed({
  sessionId,
  workspaceDiffTarget,
  ...viewProps
}: ActivityFeedProps) {
  const openWorkspaceDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)
  const openPlanDocumentTab = useBrowserPanelStore(s => s.openPlanDocumentTab)
  const openArtifactTab = useBrowserPanelStore(s => s.openArtifactTab)

  const handleOpenWorkspaceDiff = useCallback((path: string) => {
    if (!workspaceDiffTarget) {
      return
    }
    const tabId = openWorkspaceDiffTab({
      workspaceId: workspaceDiffTarget.workspaceId,
      title: 'All Changes',
      ownerId: workspaceDiffTarget.ownerId,
    })
    requestScrollToFilePath({ path, tabId })
  }, [openWorkspaceDiffTab, requestScrollToFilePath, workspaceDiffTarget])

  const handleOpenPlanDocument = useCallback((input: PlanDocumentOpenInput) => {
    openPlanDocumentTab(input)
  }, [openPlanDocumentTab])

  const handleOpenArtifact = useCallback((input: ArtifactOpenInput) => {
    openArtifactTab({
      sessionId: input.sessionId,
      artifactId: input.artifactId,
      toolCallId: input.toolCallId,
      title: input.title,
      source: input.source,
      revision: input.revision,
    })
  }, [openArtifactTab])

  return (
    <ActivityFeedView
      {...viewProps}
      blobSessionId={sessionId}
      onOpenWorkspaceDiff={workspaceDiffTarget ? handleOpenWorkspaceDiff : undefined}
      onOpenPlanDocument={handleOpenPlanDocument}
      onOpenArtifact={handleOpenArtifact}
    />
  )
}
