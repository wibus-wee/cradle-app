import { lazy, Suspense, useMemo } from 'react'

import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'

import { preloadWorkspaceDetailTerminalPanel } from './workspace-detail-terminal-panel-loader'

const BottomTerminalPanel = lazy(() => (
  preloadWorkspaceDetailTerminalPanel()
    .then(module => ({ default: module.BottomTerminalPanel }))
))

export interface WorkspaceDetailLayoutSlotsRuntimeProps {
  workspaceId: string
  workspacePath: string | null
}

export function WorkspaceDetailLayoutSlotsRuntime({
  workspaceId,
  workspacePath,
}: WorkspaceDetailLayoutSlotsRuntimeProps) {
  'use no memo'

  const panel = useMemo(
    () => (
      <Suspense fallback={null}>
        {workspacePath
          ? (
              <BottomTerminalPanel
                ownerId={`workspace:${workspaceId}`}
                cwd={workspacePath}
              />
            )
          : null}
      </Suspense>
    ),
    [workspaceId, workspacePath],
  )

  useRegisterLayoutSlots(`workspace-detail:${workspaceId}`, useMemo(() => ({
    asideWorkspaceId: workspaceId,
    hasAside: true,
    hasBrowserPanel: true,
    hasPanel: true,
    panel,
  }), [panel, workspaceId]))

  return null
}
