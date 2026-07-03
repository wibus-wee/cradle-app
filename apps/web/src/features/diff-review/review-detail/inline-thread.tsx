import { useState } from 'react'
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
  const lastComment = thread.comments.at(-1)
  const resolved = thread.state === 'resolved'

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    onExpandedChange?.(next ? thread.id : null)
  }

  return (
    <div
      className="my-px border-l border-border bg-muted/30"
      data-testid="inline-thread"
      data-thread-state={thread.state}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={toggle}
        className="h-auto w-full justify-start rounded-none px-3 py-1.5 text-left font-normal hover:bg-muted/50"
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            resolved ? 'bg-emerald-500' : thread.state === 'stale' ? 'bg-amber-500' : 'bg-orange-500',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
          {lastComment ? lastComment.bodyMarkdown.split('\n')[0] : 'Thread'}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {thread.comments.length}
        </span>
      </Button>

      {expanded && (
        <div className="space-y-1.5 px-3 pb-2 pl-5">
          {thread.comments.map(comment => (
            <div key={comment.id} className="space-y-0.5">
              <div className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{comment.authorId}</span>
                <span className="tabular-nums">{formatTimestamp(comment.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
                {comment.bodyMarkdown}
              </p>
            </div>
          ))}

          {resolved
            ? null
            : replying
              ? (
                  <div className="space-y-1.5 pt-1">
                    <Textarea
                      autoFocus
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault()
                          const body = draft.trim()
                          if (body) {
                            onReply(thread.id, body)
                            setDraft('')
                            setReplying(false)
                          }
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setReplying(false)
                          setDraft('')
                        }
                      }}
                      placeholder={t('thread.reply.placeholder' as DiffReviewKey)}
                      className="min-h-7 resize-none text-[12px]"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[12px] text-muted-foreground"
                        onClick={() => {
                          setReplying(false)
                          setDraft('')
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[12px] text-muted-foreground"
                        onClick={() => onResolve(thread.id)}
                        disabled={resolvePending}
                      >
                        Resolve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-6 text-[12px]"
                        disabled={!draft.trim() || replyPending}
                        onClick={() => {
                          const body = draft.trim()
                          if (body) {
                            onReply(thread.id, body)
                            setDraft('')
                            setReplying(false)
                          }
                        }}
                      >
                        Reply
                      </Button>
                    </div>
                  </div>
                )
              : (
                  <div className="flex items-center gap-2 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReplying(true)}
                      className="h-auto px-0 py-0 text-[12px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                      Reply
                    </Button>
                    {onAskAgent && (
                      <>
                        <span className="text-muted-foreground/30">·</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onAskAgent(thread.id)}
                          className="h-auto px-0 py-0 text-[12px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                        >
                          Ask agent
                        </Button>
                      </>
                    )}
                    <span className="text-muted-foreground/30">·</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onResolve(thread.id)}
                      disabled={resolvePending}
                      className="h-auto px-0 py-0 text-[12px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                      Resolve
                    </Button>
                  </div>
                )}
        </div>
      )}
    </div>
  )
}
