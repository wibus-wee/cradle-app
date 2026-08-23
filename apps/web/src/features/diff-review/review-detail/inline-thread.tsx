import {
  CheckLine as CheckIcon,
  DownLine as ChevronDownIcon,
  RightLine as ChevronRightIcon,
} from '@mingcute/react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import { formatTimestamp } from '../shared/diff-items'
import type { ReviewThread } from '../shared/types'

type DiffReviewKey = keyof typeof import('~/locales/default').default['diff-review']

interface InlineThreadProps {
  thread: ReviewThread
  onReply: (threadId: string, bodyMarkdown: string) => void
  replyPending: boolean
  onResolve: (threadId: string) => void
  resolvePending: boolean
  onAskAgent?: (threadId: string) => void
  onExpandedChange?: (id: string | null) => void
}

function ThreadAction({ onClick, disabled, children }: {
  onClick: () => void
  disabled?: boolean
  children: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-auto px-0 py-0 text-[11.5px] font-normal text-muted-foreground',
        'hover:bg-transparent hover:text-foreground',
      )}
    >
      {children}
    </Button>
  )
}

/**
 * Inline comment thread, rendered inside a Pierre annotation slot.
 *
 * A raised card with one bordered bubble per comment — Linear-style: quiet
 * chrome, the words carry the weight. Annotation slots are half the diff
 * width in split view, so everything wraps and nothing has wide intrinsic
 * width.
 */
export function InlineThread({
  thread,
  onReply,
  replyPending,
  onResolve,
  resolvePending,
  onAskAgent,
  onExpandedChange,
}: InlineThreadProps) {
  const { t } = useTranslation('diff-review')
  const [expanded, setExpanded] = useState(thread.state !== 'resolved')
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const resolved = thread.state === 'resolved'

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    onExpandedChange?.(next ? thread.id : null)
  }

  const submitReply = () => {
    const body = draft.trim()
    if (!body) {
      return
    }
    onReply(thread.id, body)
    setDraft('')
    setReplying(false)
  }

  return (
    <div
      className="min-w-0 px-1.5 py-0.5"
      data-testid="inline-thread"
      data-thread-state={thread.state}
    >
      <div
        className={cn(
          'min-w-0 overflow-hidden rounded-lg border bg-card',
          resolved ? 'border-border/60' : 'border-border shadow-[var(--rv-shadow-raised)]',
        )}
      >
        {resolved && (
          <button
            type="button"
            onClick={toggle}
            className={cn(
              'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left',
              'text-[11.5px] text-muted-foreground hover:bg-muted/50',
            )}
          >
            {expanded
              ? <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
              : <ChevronRightIcon className="size-3 shrink-0" aria-hidden />}
            <CheckIcon className="size-3 shrink-0 text-emerald-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {thread.comments[0]?.bodyMarkdown.split('\n')[0]}
            </span>
            <span className="shrink-0 tabular-nums">{thread.comments.length}</span>
          </button>
        )}

        {expanded && (
          <>
            <div className="min-w-0 divide-y divide-border/60">
              {thread.comments.map(comment => (
                <div key={comment.id} className="min-w-0 px-2.5 py-2">
                  <div className="flex items-baseline gap-1.5 text-[11px] leading-none">
                    <span className="font-medium text-foreground/80">{comment.authorId}</span>
                    <span className="tabular-nums text-muted-foreground/60">
                      {formatTimestamp(comment.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground/90">
                    {comment.bodyMarkdown}
                  </p>
                </div>
              ))}
            </div>

            {!resolved && (
              <div className="border-t border-border/60">
                {replying
                  ? (
                      <div className="space-y-1 p-2 pt-1.5">
                        <Textarea
                          autoFocus
                          value={draft}
                          onChange={event => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                              event.preventDefault()
                              submitReply()
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              setReplying(false)
                              setDraft('')
                            }
                          }}
                          placeholder={t('thread.reply.placeholder' as DiffReviewKey)}
                          className="max-h-48 min-h-9 resize-none text-[12.5px]"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] text-muted-foreground/60">
                            {t('thread.composer.submitHint' as DiffReviewKey, { shortcut: '⌘↵' })}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[12px] text-muted-foreground"
                              onClick={() => {
                                setReplying(false)
                                setDraft('')
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-6 px-2.5 text-[12px]"
                              disabled={!draft.trim() || replyPending}
                              onClick={submitReply}
                            >
                              Reply
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  : (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
                        <ThreadAction onClick={() => setReplying(true)}>Reply</ThreadAction>
                        {onAskAgent && (
                          <Fragment>
                            <span className="text-muted-foreground/30">·</span>
                            <ThreadAction onClick={() => onAskAgent(thread.id)}>Ask agent</ThreadAction>
                          </Fragment>
                        )}
                        <span className="text-muted-foreground/30">·</span>
                        <ThreadAction onClick={() => onResolve(thread.id)} disabled={resolvePending}>
                          Resolve
                        </ThreadAction>
                      </div>
                    )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
