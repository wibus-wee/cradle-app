import { cn } from '~/lib/cn'

import type { BrowserChromeStatus } from './browser-panel.logic'

export interface BrowserChromeStatusViewProps {
  status: BrowserChromeStatus
}

export function BrowserChromeStatusView({
  status,
}: BrowserChromeStatusViewProps) {
  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center border-b px-3 text-[11px]',
        status.tone === 'error'
          ? 'border-destructive/20 bg-destructive/8 text-destructive'
          : 'border-border/40 bg-muted/40 text-muted-foreground',
      )}
      role={status.tone === 'error' ? 'alert' : 'status'}
    >
      {status.label}
    </div>
  )
}
