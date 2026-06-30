import { CornerDownRightLine as CornerDownRightIcon } from '@mingcute/react'
import type { MouseEvent, PointerEvent } from 'react'

import { cn } from '~/lib/cn'

interface ParentIssueLinkProps {
  parentIssueKey: string
  variant: 'card' | 'row'
  onOpen: () => void
}

export function ParentIssueLink({ parentIssueKey, variant, onOpen }: ParentIssueLinkProps) {
  const stopPointerPropagation = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  const openParentIssue = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onOpen()
  }

  return (
    <button
      type="button"
      aria-label={`Open parent issue ${parentIssueKey}`}
      title={`Parent issue ${parentIssueKey}`}
      onClick={openParentIssue}
      onPointerDown={stopPointerPropagation}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm text-muted-foreground',
        'transition-[color,background-color,scale] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'active:scale-[0.96]',
        variant === 'card' && 'min-h-5 px-1 py-0.5 text-[10.5px]',
        variant === 'row' && 'h-6 min-w-10 px-1.5 text-[11px]',
      )}
    >
      <CornerDownRightIcon className="size-3" aria-hidden="true" />
      <span className="font-mono tabular-nums">{parentIssueKey}</span>
    </button>
  )
}
