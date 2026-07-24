import { DownloadTaskRowView } from './download-task-row-view'
import { openDownloadRetryDestination } from './open-download-retry-destination'
import type { DownloadTask } from './types'
import { useDownloadCenterCancel } from './use-download-center'

export interface DownloadTaskRowProps {
  task: DownloadTask
  showFileName?: boolean
}

export function DownloadTaskRow({
  task,
  showFileName = false,
}: DownloadTaskRowProps) {
  const cancel = useDownloadCenterCancel()

  return (
    <DownloadTaskRowView
      task={task}
      showFileName={showFileName}
      onCancel={taskToCancel => void cancel(taskToCancel)}
      onRetry={openDownloadRetryDestination}
    />
  )
}
