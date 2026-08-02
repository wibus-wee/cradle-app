import { Chat1Line as AddToChatIcon, CommentLine as CommentIcon } from '@mingcute/react'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface CodeCommentData {
  title?: string
  body?: string
  file?: string
  start?: string
  end?: string
  priority?: string
}

export interface CodeCommentBlockViewProps extends CodeCommentData {
  fileLink?: ReactNode
  onAddToComposer?: (comment: CodeCommentData) => void
}

const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  P0: 'bg-destructive/10 text-destructive',
  P1: 'bg-destructive/10 text-destructive',
  P2: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  P3: 'bg-muted text-muted-foreground',
}

/** Fixture-driven presentation for a line-level review finding. */
export function CodeCommentBlockView({
  title,
  body,
  priority,
  fileLink,
  onAddToComposer,
  ...comment
}: CodeCommentBlockViewProps) {
  const normalizedPriority = priority?.toUpperCase()

  return (
    <section className="my-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 shadow-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <CommentIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {normalizedPriority
          ? (
              <span
                className={cn(
                  'shrink-0 rounded px-1 py-px text-[10px] font-semibold leading-4',
                  PRIORITY_BADGE_CLASSES[normalizedPriority] ?? PRIORITY_BADGE_CLASSES.P3,
                )}
              >
                {normalizedPriority}
              </span>
            )
          : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title ?? 'Code comment'}
        </span>
        {onAddToComposer
          ? (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                title="Append this comment to the composer"
                onClick={() => onAddToComposer({ title, body, priority, ...comment })}
              >
                <AddToChatIcon className="size-3" aria-hidden="true" />
                Add to Chat
              </Button>
            )
          : null}
      </div>
      {fileLink ? <div className="mt-1 text-[11px] text-muted-foreground">{fileLink}</div> : null}
      {body ? <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{body}</p> : null}
    </section>
  )
}
