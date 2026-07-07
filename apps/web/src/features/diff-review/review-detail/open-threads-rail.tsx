import {
  CloseLine as XIcon,
  Message4Line as MessagesSquareIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { CradleDiffReview, ReviewFile, ReviewThread } from '../shared/types'

interface OpenThreadsRailProps {
  review: CradleDiffReview
  files: ReviewFile[]
  onJumpToThread: (thread: ReviewThread) => void
  onResolve: (threadId: string) => void
  resolvePending: boolean
  onAskAgent?: (threadId: string) => void
  onCollapse: () => void
  width: number
}

export function OpenThreadsRail({
  review,
  files,
  onJumpToThread,
  onResolve,
  resolvePending,
  onAskAgent,
  onCollapse,
  width,
}: OpenThreadsRailProps) {
  const fileById = new Map(files.map(file => [file.id, file]))
  const openThreads = review.threads.filter(thread => thread.state !== 'resolved')

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col border-l border-border/60 bg-background"
      style={{ width }}
      data-testid="open-threads-rail"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
        <span className="text-[12px] font-medium text-foreground/70">Threads</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">{openThreads.length}</span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCollapse}
          className="size-5 rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          aria-label="Hide threads"
        >
          <XIcon className="size-3" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {openThreads.length === 0
          ? (
              <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center">
                <MessagesSquareIcon className="size-4 !text-muted-foreground/30" aria-hidden />
                <p className="text-[11px] text-muted-foreground/60">No open threads</p>
              </div>
            )
          : (
              <div className="py-1">
                {openThreads.map((thread) => {
                  const file = thread.fileId ? fileById.get(thread.fileId) : null
                  const last = thread.comments.at(-1)
                  const path = file?.path ?? 'Thread'
                  return (
                    <div
                      key={thread.id}
                      className="group relative"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onJumpToThread(thread)}
                        className="h-auto w-full items-start justify-start rounded-none px-3 py-1.5 text-left font-normal hover:bg-muted/50"
                      >
                        <span
                          className={cn(
                            'mt-1 size-1.5 shrink-0 rounded-full',
                            thread.state === 'stale' ? 'bg-amber-500' : 'bg-orange-500',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/70">
                              {path}
                            </span>
                            {thread.anchor && (
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/60">
                                L
{thread.anchor.startLine}
                              </span>
                            )}
                          </span>
                          {last && (
                            <span className="mt-0.5 block truncate text-[12px] text-foreground/80">
                              {last.bodyMarkdown.split('\n')[0]}
                            </span>
                          )}
                          <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground/50">
                            {thread.comments.length}
                            {' '}
                            comment
                            {thread.comments.length === 1 ? '' : 's'}
                            {thread.state === 'stale' ? ' · stale' : ''}
                          </span>
                        </span>
                        <ChevronRightIcon className="mt-1 size-3 shrink-0 !text-muted-foreground/30" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onResolve(thread.id)}
                        disabled={resolvePending}
                        className="absolute right-7 top-1.5 hidden size-5 rounded text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
                        aria-label="Resolve thread"
                        title="Resolve"
                      >
                        <XIcon className="size-3" />
                      </Button>
                      {onAskAgent && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onAskAgent(thread.id)}
                          className="ml-8 mb-1 hidden h-auto rounded px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground group-hover:inline-flex"
                        >
                          Ask agent
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
      </div>
    </aside>
  )
}
