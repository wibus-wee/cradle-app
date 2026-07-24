import { useCallback } from 'react'

import { useBrowserPanelStore } from '~/store/browser-panel'

import type { GroupedToolCallBlockViewProps } from '../views/grouped-tool-call-block-view'
import { GroupedToolCallBlockView } from '../views/grouped-tool-call-block-view'

/** Runtime adapter that connects grouped file actions to browser-panel state. */
export function GroupedToolCallBlock({
  workspaceDiffTarget,
  ...viewProps
}: Omit<GroupedToolCallBlockViewProps, 'onOpenWorkspaceDiff'> & {
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
}) {
  const openWorkspaceDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)
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

  return (
    <GroupedToolCallBlockView
      {...viewProps}
      onOpenWorkspaceDiff={workspaceDiffTarget ? handleOpenWorkspaceDiff : undefined}
    />
  )
}
