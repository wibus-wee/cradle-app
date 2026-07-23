import { openResources, openSettingsSection } from '~/navigation/navigation-commands'

import { DownloadCenterView } from './download-center-view'
import { DownloadTaskRowView } from './download-task-row-view'
import { retryDestination } from './presentation'
import type { DownloadTask } from './types'
import { useDownloadCenter, useDownloadCenterCancel } from './use-download-center'

export function DownloadTaskRow({
  task,
  showFileName = false,
}: {
  task: DownloadTask
  showFileName?: boolean
}) {
  const cancel = useDownloadCenterCancel()

  return (
    <DownloadTaskRowView
      task={task}
      showFileName={showFileName}
      onCancel={taskToCancel => void cancel(taskToCancel)}
      onRetry={openRetryDestination}
    />
  )
}

export function DownloadCenterChrome({ className }: { className?: string }) {
  const { active, recent } = useDownloadCenter()
  const cancel = useDownloadCenterCancel()

  return (
    <DownloadCenterView
      active={active}
      recent={recent}
      onCancel={task => void cancel(task)}
      onRetry={openRetryDestination}
      onViewAll={openResources}
      className={className}
    />
  )
}

function openRetryDestination(task: DownloadTask): void {
  const destination = retryDestination(task)
  if (destination === 'resources') {
    openResources()
  }
  else if (destination === 'desktop') {
    openSettingsSection(destination)
  }
}
