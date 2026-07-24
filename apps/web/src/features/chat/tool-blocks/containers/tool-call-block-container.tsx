import { useCallback } from 'react'

import { useBrowserPanelStore } from '~/store/browser-panel'

import type { ToolCallBlockProps } from '../lib/tool-call-block-types'
import type { PlanDocumentOpenInput } from '../views/plan-document-preview-view'
import type { ToolCallBlockViewProps } from '../views/tool-call-block-view'
import { ToolCallBlockView } from '../views/tool-call-block-view'

type WorkflowSurfaceChange = Parameters<
  NonNullable<ToolCallBlockViewProps['onWorkflowSurfaceChange']>
>[0]
type WorkflowSurfaceOpen = Parameters<
  NonNullable<ToolCallBlockViewProps['onOpenWorkflowSurface']>
>[0]
type SubagentOutputOpen = Parameters<
  NonNullable<ToolCallBlockViewProps['onOpenSubagentOutput']>
>[0]
type PlanDocumentOpen = PlanDocumentOpenInput

/** Runtime adapter that connects the props-only tool surface to browser-panel state. */
export function ToolCallBlock({
  sessionId,
  workspaceDiffTarget,
  ...viewProps
}: ToolCallBlockProps) {
  const openWorkspaceDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const openSubagentTab = useBrowserPanelStore(s => s.openSubagentTab)
  const openWorkflowTab = useBrowserPanelStore(s => s.openWorkflowTab)
  const updateWorkflowTab = useBrowserPanelStore(s => s.updateWorkflowTab)
  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)
  const openPlanDocumentTab = useBrowserPanelStore(s => s.openPlanDocumentTab)

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

  const handleOpenSubagentOutput = useCallback((input: SubagentOutputOpen) => {
    if (!sessionId) {
      return
    }
    const ownerId = useBrowserPanelStore.getState().activeOwnerId
    openSubagentTab({
      sessionId,
      threadId: input.toolCallId,
      agentName: input.agentName,
      agentRole: input.agentRole,
      ownerId,
    })
  }, [openSubagentTab, sessionId])

  const handleOpenWorkflowSurface = useCallback((input: WorkflowSurfaceOpen) => {
    openWorkflowTab({
      sessionId,
      toolCallId: input.toolCallId,
      title: input.title,
      surface: input.surface,
    })
  }, [openWorkflowTab, sessionId])

  const handleWorkflowSurfaceChange = useCallback((input: WorkflowSurfaceChange) => {
    updateWorkflowTab({
      sessionId,
      toolCallId: input.toolCallId,
      surface: input.surface,
    })
  }, [sessionId, updateWorkflowTab])

  const handleOpenPlanDocument = useCallback((input: PlanDocumentOpen) => {
    openPlanDocumentTab(input)
  }, [openPlanDocumentTab])

  return (
    <ToolCallBlockView
      {...viewProps}
      onOpenWorkspaceDiff={workspaceDiffTarget ? handleOpenWorkspaceDiff : undefined}
      onOpenSubagentOutput={sessionId ? handleOpenSubagentOutput : undefined}
      onOpenWorkflowSurface={handleOpenWorkflowSurface}
      onWorkflowSurfaceChange={handleWorkflowSurfaceChange}
      onOpenPlanDocument={handleOpenPlanDocument}
    />
  )
}
