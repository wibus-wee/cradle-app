import { RobotLine as RobotIcon } from '@mingcute/react'
import { useState } from 'react'

import { cn } from '~/lib/cn'

/** Registry agent icon with the same surface treatment as built-in runtime icons. */
export function AcpAgentIcon({
  iconUrl,
  className,
  iconClassName,
}: {
  iconUrl?: string | null
  className?: string
  iconClassName?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = Boolean(iconUrl) && failedUrl !== iconUrl

  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-fill', className)}>
      {showImage
        ? (
            <img
              src={iconUrl ?? undefined}
              alt=""
              className="size-full object-contain p-[16%] dark:invert"
              onError={() => setFailedUrl(iconUrl ?? null)}
            />
          )
        : (
            <div className="flex size-full items-center justify-center">
              <RobotIcon className={cn('size-1/2 text-text-tertiary', iconClassName)} aria-hidden="true" />
            </div>
          )}
    </div>
  )
}
