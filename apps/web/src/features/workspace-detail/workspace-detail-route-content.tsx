import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect } from 'react'

import { getWorkspacesByWorkspaceId } from '~/api-gen/sdk.gen'
import type { Workspace } from '~/features/workspace/types'
import { getLocalWorkspacePath } from '~/features/workspace/types'
import { useSurfaceStore } from '~/navigation/surface-store'

import {
  WorkspaceDetailLayoutSlotsRuntime,
} from './workspace-detail-layout-slots-runtime'
import { preloadWorkspaceDetailTerminalPanel } from './workspace-detail-terminal-panel-loader'

const WorkspaceDetailPageContainer = lazy(() => (
  import('./workspace-detail-page-container')
    .then(module => ({ default: module.WorkspaceDetailPageContainer }))
))

export function WorkspaceDetailRouteContent({ workspaceId }: { workspaceId: string }) {
  'use no memo'

  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const { data: workspace } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByWorkspaceId({ path: { workspaceId } })
      return data as Workspace | undefined
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  })
  const workspacePath = getLocalWorkspacePath(workspace)

  useEffect(() => {
    if (workspace?.name) {
      updateSurfaceTitle(`workspace:${workspaceId}`, workspace.name)
    }
  }, [updateSurfaceTitle, workspace?.name, workspaceId])

  useEffect(() => {
    if (workspacePath) {
      void preloadWorkspaceDetailTerminalPanel()
    }
  }, [workspacePath])

  return (
    <>
      <WorkspaceDetailLayoutSlotsRuntime
        workspaceId={workspaceId}
        workspacePath={workspacePath}
      />
      <Suspense fallback={null}>
        <WorkspaceDetailPageContainer
          workspaceId={workspaceId}
          workspace={workspace}
        />
      </Suspense>
    </>
  )
}
