import { PlusLine as PlusIcon, RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import { m } from 'motion/react'

import { cn } from '~/lib/cn'

import { StatusIcon } from './shared/status-icon'
import type { StatusCategory } from './use-view-config'

interface GroupHeaderProps {
  name: string
  count: number
  category?: StatusCategory
  collapsed: boolean
  onToggle: () => void
  onCreateIssue?: () => void
}

export function KanbanGroupHeader({ name, count, category, collapsed, onToggle, onCreateIssue }: GroupHeaderProps) {
  return (
    <div className="group/header flex items-center h-8 px-2 gap-1.5 bg-muted/60 rounded-lg">
      <button
        onClick={onToggle}
        aria-label={`Toggle ${name} group`}
        aria-expanded={!collapsed}
        className={cn(
          'flex flex-1 items-center gap-1.5 h-full text-[12px] font-medium text-muted-foreground',
          'hover:text-foreground transition-colors duration-150',
        )}
      >
        <m.span
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
          className="flex items-center text-muted-foreground"
        >
          <ChevronRightIcon className="size-3" aria-hidden="true" />
        </m.span>
        {category && <StatusIcon category={category} size={14} />}
        <span>{name}</span>
        <span className="rounded px-1.5 py-0.5 bg-muted text-muted-foreground text-[11px] tabular-nums font-normal">
          {count}
        </span>
      </button>

      {onCreateIssue && (
        <button
          onClick={onCreateIssue}
          aria-label={`Create issue in ${name}`}
          className={cn(
            'flex size-5 items-center justify-center rounded text-muted-foreground',
            'opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100',
            'hover:bg-muted hover:text-foreground transition-[background-color,color,opacity] duration-150',
          )}
        >
          <PlusIcon className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
