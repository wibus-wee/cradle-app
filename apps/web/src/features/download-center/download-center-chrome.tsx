import { openResources } from '~/navigation/navigation-commands'

import { DownloadCenterView } from './download-center-view'
import { openDownloadRetryDestination } from './open-download-retry-destination'
import { useDownloadCenter, useDownloadCenterCancel } from './use-download-center'

export function DownloadCenterChrome({ className }: { className?: string }) {
  const { active, recent } = useDownloadCenter()
  const cancel = useDownloadCenterCancel()

  return (
    <DownloadCenterView
      active={active}
      recent={recent}
      onCancel={task => void cancel(task)}
      onRetry={openDownloadRetryDestination}
      onViewAll={openResources}
      className={className}
    />
  )
}
