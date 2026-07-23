import type { ReactNode } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

export interface WorkspaceSidebarNavItemViewProps {
  active?: boolean
  icon: ReactNode
  label: string
  shortcut?: string
  collapsed: boolean
  onClick: () => void
  dataTestId?: string
}

export function WorkspaceSidebarNavItemView({
  active = false,
  icon,
  label,
  shortcut,
  collapsed,
  onClick,
  dataTestId,
}: WorkspaceSidebarNavItemViewProps) {
  const iconNode = (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70">
      {icon}
    </span>
  )

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      className={cn(
        'group flex h-7 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1.5 text-xs text-sidebar-foreground/80 hover:bg-accent/50 hover:text-sidebar-foreground',
        active && 'bg-accent/70 text-sidebar-foreground',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {collapsed
        ? (
            <Tooltip>
              <TooltipTrigger asChild>{iconNode}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {label}
              </TooltipContent>
            </Tooltip>
          )
        : iconNode}
      <span
        className={cn(
          'flex-1 overflow-hidden whitespace-nowrap text-left',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        {label}
      </span>
      {shortcut
        ? (
            <span
              className={cn(
                'shrink-0 overflow-hidden whitespace-nowrap font-mono text-[10px] text-muted-foreground/40',
                collapsed
                  ? 'opacity-0'
                  : 'opacity-0 group-hover:opacity-100',
              )}
            >
              {shortcut}
            </span>
          )
        : null}
    </button>
  )
}
