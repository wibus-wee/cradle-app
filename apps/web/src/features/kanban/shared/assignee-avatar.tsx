import { User2Line as UserIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

export function AssigneeAvatar({ name, size = 20, className }: {
  name?: string | null
  size?: number
  className?: string
}) {
  const initial = name?.charAt(0)?.toUpperCase()

  return (
    <span
      className={cn(
        'shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground',
        'border border-border',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {initial
        ? <span className="text-[10px] font-medium">{initial}</span>
        : <UserIcon className="size-3" aria-hidden="true" />}
    </span>
  )
}
