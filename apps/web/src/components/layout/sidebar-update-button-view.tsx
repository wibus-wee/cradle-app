import {
  DownloadLine as DownloadIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import type { DesktopUpdateStatus } from '~/lib/electron'

interface SidebarUpdateButtonViewProps {
  collapsed: boolean
  status: DesktopUpdateStatus
  statusLabel: string
  buttonLabel: string
  tooltipTitle: string
  availableLabel?: string | null
  isDownloading?: boolean
  onOpen: () => void
}

export function SidebarUpdateButtonView({
  collapsed,
  status,
  statusLabel,
  buttonLabel,
  tooltipTitle,
  availableLabel,
  isDownloading = false,
  onOpen,
}: SidebarUpdateButtonViewProps) {
  const Icon = status.updateDownloaded || isDownloading || status.isPreparingUpdate
    ? DownloadIcon
    : SparklesIcon

  return (
    <TooltipProvider delayDuration={collapsed ? 0 : 500}>
      <div className="shrink-0 px-2 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={collapsed ? 'icon-sm' : 'sm'}
              onClick={onOpen}
              className={cn(
                'relative w-full justify-start gap-2 overflow-hidden text-sidebar-foreground/75 hover:bg-fill/80 hover:text-sidebar-foreground',
                'active:scale-[0.96]',
                collapsed && 'pl-1.5',
                status.updateInfo && 'bg-info/10 text-info hover:bg-info/15 hover:text-info',
              )}
              aria-label={statusLabel}
              data-testid="sidebar-update-button"
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                <Icon className="size-3.5" aria-hidden="true" />
                {status.updateInfo && (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-info ring-2 ring-sidebar" />
                )}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-left text-[12px]', collapsed && 'sr-only')}>
                {buttonLabel}
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground',
                  collapsed && 'sr-only',
                )}
              >
                {status.updateInfo?.version ?? status.currentVersion}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="mb-1 max-w-72 flex-col items-start gap-1.5 p-2.5">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="font-medium">{tooltipTitle}</span>
              <span className="font-mono text-[11px] tabular-nums text-background/70">
                {status.currentVersion}
              </span>
            </div>
            <div className="text-[11px] text-background/70">{statusLabel}</div>
            {availableLabel && (
              <div className="font-mono text-[11px] tabular-nums text-background/80">
                {availableLabel}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
