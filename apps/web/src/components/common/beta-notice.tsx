import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

interface BetaNoticeProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode
  description: ReactNode
  label?: ReactNode
}

export function BetaNotice({
  title,
  description,
  label = 'Beta',
  className,
  ...props
}: BetaNoticeProps) {
  return (
    <div
      role="note"
      className={cn(
        'flex min-h-9 shrink-0 items-center justify-center gap-2 bg-muted px-4 py-2 text-xs text-muted-foreground border-b border-border/80',
        className,
      )}
      {...props}
    >
      <Badge
        variant="outline"
      >
        {label}
      </Badge>
      <div className="min-w-0 truncate">
        <span className="font-medium text-foreground">{title}</span>
        <span className="mx-1.5 text-muted-foreground/40">/</span>
        <span>{description}</span>
      </div>
    </div>
  )
}
