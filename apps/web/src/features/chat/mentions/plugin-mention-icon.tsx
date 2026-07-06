import { PluginLine as PlugIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

export function PluginMentionIcon({
  iconUrl,
  className,
}: {
  iconUrl: string | null | undefined
  className?: string
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden="true"
        className={cn('size-4 shrink-0 rounded-sm object-cover ring-1 ring-black/10 dark:ring-white/10', className)}
        loading="lazy"
      />
    )
  }

  return (
    <PlugIcon
      className={cn('size-3.5 shrink-0 !text-sky-600 dark:!text-sky-400', className)}
      aria-hidden="true"
    />
  )
}
