import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { openDownloadRetryDestination } from '~/features/download-center/open-download-retry-destination'
import { isActiveDownload } from '~/features/download-center/types'
import {
  useDownloadCenter,
  useDownloadCenterCancel,
} from '~/features/download-center/use-download-center'

import { getManagedResourcesQueryKey } from './api/managed-resources-api'
import { ManagedResourcesPageView } from './managed-resources-page-view'
import type { ManagedResource } from './projection'
import { managedResourceKey } from './projection'
import type { ManagedResourceAction } from './use-managed-resources'
import {
  useManagedResourceAction,
  useManagedResources,
} from './use-managed-resources'

export function ManagedResourcesPage() {
  const queryClient = useQueryClient()
  const resourcesQuery = useManagedResources()
  const { tasks, active } = useDownloadCenter()
  const cancelTask = useDownloadCenterCancel()
  const action = useManagedResourceAction()
  const terminalRevision = useMemo(
    () => tasks
      .filter(task => !isActiveDownload(task))
      .map(task => `${task.scope}:${task.taskId}:${task.status}:${task.updatedAt}`)
      .join('|'),
    [tasks],
  )
  const previousTerminalRevisionRef = useRef(terminalRevision)

  useEffect(() => {
    if (previousTerminalRevisionRef.current === terminalRevision) {
      return
    }
    previousTerminalRevisionRef.current = terminalRevision
    void queryClient.invalidateQueries({ queryKey: getManagedResourcesQueryKey() })
  }, [queryClient, terminalRevision])

  const runResourceAction = (
    resource: ManagedResource,
    nextAction: ManagedResourceAction,
  ) => {
    action.mutate({ resource, action: nextAction })
  }
  const actionResourceKey = action.variables
    ? managedResourceKey(action.variables.resource)
    : null

  return (
    <ManagedResourcesPageView
      resources={resourcesQuery.resources}
      tasks={tasks}
      activeTasks={active}
      loading={resourcesQuery.isLoading}
      error={resourcesQuery.isError}
      actionResourceKey={actionResourceKey}
      actionPending={action.isPending}
      actionError={action.isError}
      onRetryResources={() => void resourcesQuery.refetch()}
      onResourceAction={runResourceAction}
      onCancelTask={task => void cancelTask(task)}
      onRetryTask={openDownloadRetryDestination}
    />
  )
}
