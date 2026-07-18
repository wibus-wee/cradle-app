import {
  CheckLine as CheckIcon,
  CloseLine as CloseIcon,
  GitCommitLine as GitCommitHorizontalIcon,
  Message1Line as MessageSquareIcon,
  Refresh1Line as RefreshCwIcon,
  RobotLine as BotIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
  SendLine as SendIcon,
  TreeLine as ListTreeIcon,
} from '@mingcute/react'
import { useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffLayoutToggle } from '~/components/common/diff/diff-layout-toggle'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import { formatChangeStats, sourceLabel } from '../shared/diff-items'
import type { CradleDiffReview, DiffStyle, ReviewDecision } from '../shared/types'

type DiffReviewKey = keyof typeof import('~/locales/default').default['diff-review']

interface ReviewTopBarProps {
  review: CradleDiffReview
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  onPreference: (input: { hideWhitespaceOnly?: boolean, collapseGeneratedFiles?: boolean }) => void
  preferencePending: boolean
  onSubmit: (decision: ReviewDecision, bodyMarkdown: string) => void
  submitPending: boolean
  onCloseReview: () => void
  closeReviewPending: boolean
  onRefresh: () => void
  refreshPending: boolean
  isFetching: boolean
  onOpenGuide?: () => void
  hasGuide?: boolean
  onOpenCommit?: () => void
  hasCommitPlan?: boolean
  threadsRailCollapsed: boolean
  agentRailActive: boolean
  onShowThreadsRail: () => void
  onShowAgentRail: () => void
  openThreadCount: number
  agentFixCount: number
}

const REVIEW_STATE_TONE: Record<CradleDiffReview['reviewState'], string> = {
  'unreviewed': 'bg-muted-foreground/40',
  'in-review': 'bg-sky-500',
  'changes-requested': 'bg-orange-500',
  'approved': 'bg-emerald-500',
  'commented': 'bg-muted-foreground/40',
}

export function ReviewTopBar({
  review,
  diffStyle,
  onDiffStyleChange,
  onPreference,
  preferencePending,
  onSubmit,
  submitPending,
  onCloseReview,
  closeReviewPending,
  onRefresh,
  refreshPending,
  isFetching,
  onOpenGuide,
  hasGuide = false,
  onOpenCommit,
  hasCommitPlan,
  threadsRailCollapsed,
  agentRailActive,
  onShowThreadsRail,
  onShowAgentRail,
  openThreadCount,
  agentFixCount,
}: ReviewTopBarProps) {
  const [isDiffStylePending, startDiffStyleTransition] = useTransition()
  const refreshing = refreshPending || isFetching
  const canCloseReview = review.status === 'open' && review.sourceKind !== 'local-working-tree'

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 px-3" data-testid="review-top-bar">
      <span className={cn('size-1.5 shrink-0 rounded-full', REVIEW_STATE_TONE[review.reviewState])} aria-hidden />
      <div className="min-w-0">
        <h1 className="truncate text-[13px] font-medium leading-tight text-foreground">{review.title}</h1>
        <p className="truncate text-[12px] tabular-nums text-muted-foreground/70">
          {sourceLabel(review.sourceKind)}
          {' · '}
          {formatChangeStats(review)}
        </p>
      </div>

      <div className="flex-1" />

      {/* Layout — primary view control, stays visible. */}
      <DiffLayoutToggle
        value={diffStyle}
        onValueChange={value => startDiffStyleTransition(() => onDiffStyleChange(value))}
        disabled={isDiffStylePending}
      />

      {/* Display filters — secondary, icon popover. */}
      <DisplayPopover
        hideWhitespaceOnly={review.preferences.hideWhitespaceOnly}
        collapseGeneratedFiles={review.preferences.collapseGeneratedFiles}
        pending={preferencePending}
        onToggleWhitespace={() => onPreference({ hideWhitespaceOnly: !review.preferences.hideWhitespaceOnly })}
        onToggleGenerated={() => onPreference({ collapseGeneratedFiles: !review.preferences.collapseGeneratedFiles })}
      />

     {onOpenGuide && (
       <Button variant="ghost" size="sm" onClick={onOpenGuide} className="h-7 gap-1.5 px-2 text-[12px]">
         <ListTreeIcon className="size-3.5" />
         Guide
         {hasGuide && <span className="size-1.5 rounded-full bg-emerald-500" aria-label="Guide generated" />}
       </Button>
     )}

      {/* Commit plan — only for reviews whose changes can be staged into commits. */}
      {onOpenCommit && (
        <Button variant="ghost" size="sm" onClick={onOpenCommit} className="h-7 gap-1.5 px-2 text-[12px]">
          <GitCommitHorizontalIcon className="size-3.5" />
          Commit
          {hasCommitPlan && <span className="size-1.5 rounded-full bg-sky-500" aria-label="Commit plan exists" />}
        </Button>
      )}

      {/* Threads toggle — visible, badge carries the count. */}
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative size-7', !threadsRailCollapsed && !agentRailActive && 'bg-muted text-foreground')}
        onClick={onShowThreadsRail}
        aria-label="Show threads"
        title="Show threads"
      >
        <MessageSquareIcon className="size-3.5" />
        {openThreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white">
            {openThreadCount}
          </span>
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn('relative size-7', agentRailActive && 'bg-muted text-foreground')}
        onClick={onShowAgentRail}
        aria-label="Show agent"
        title="Show agent"
      >
        <BotIcon className="size-3.5" />
        {agentFixCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-medium text-white">
            {agentFixCount}
          </span>
        )}
      </Button>

      {/* Review — primary action. */}
      <ReviewPopover
        pending={submitPending}
        state={review.reviewState}
        onSubmit={onSubmit}
      />

      {canCloseReview
        ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={onCloseReview}
              disabled={closeReviewPending}
            >
              <CloseIcon className="size-3.5" />
              Close
            </Button>
          )
        : (
            <span className="rounded-md bg-muted px-2 py-1 text-[12px] font-medium capitalize text-muted-foreground">
              {review.sourceKind === 'local-working-tree' ? 'Live' : review.status}
            </span>
          )}

      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
      >
        <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
      </Button>
    </header>
  )
}

function DisplayPopover({
  hideWhitespaceOnly,
  collapseGeneratedFiles,
  pending,
  onToggleWhitespace,
  onToggleGenerated,
}: {
  hideWhitespaceOnly: boolean
  collapseGeneratedFiles: boolean
  pending: boolean
  onToggleWhitespace: () => void
  onToggleGenerated: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button variant="ghost" size="icon" className="size-7" disabled={pending} aria-label="Display options">
            <SlidersHorizontalIcon className="size-3.5" />
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-52 gap-0 p-1">
        <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">Filter</p>
        <MenuCheck active={hideWhitespaceOnly} onClick={onToggleWhitespace} disabled={pending}>
          Hide whitespace-only
        </MenuCheck>
        <MenuCheck active={collapseGeneratedFiles} onClick={onToggleGenerated} disabled={pending}>
          Collapse generated
        </MenuCheck>
      </PopoverContent>
    </Popover>
  )
}

function ReviewPopover({
  pending,
  state,
  onSubmit,
}: {
  pending: boolean
  state: CradleDiffReview['reviewState']
  onSubmit: (decision: ReviewDecision, bodyMarkdown: string) => void
}) {
  const { t } = useTranslation('diff-review')
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')

  const handleDecision = (decision: ReviewDecision) => {
    onSubmit(decision, body.trim())
    setBody('')
    setOpen(false)
  }

  const headline
    = state === 'approved'
      ? 'You approved this review'
      : state === 'changes-requested'
        ? 'You requested changes'
        : 'Finish your review'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button size="sm" className="h-7 text-[12px]" disabled={pending}>
            Review
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-[360px] gap-0 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-[12px] font-medium text-foreground/90">{headline}</p>
          <p className="text-[11px] text-muted-foreground/60">Markdown supported</p>
        </div>
        <Textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          placeholder={t('review.summary.placeholder' as DiffReviewKey)}
          className="min-h-[88px] resize-none text-[12px] leading-relaxed"
          autoFocus
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              handleDecision('comment')
            }
          }}
        />
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <DecisionButton
            onClick={() => handleDecision('comment')}
            icon={<MessageSquareIcon className="size-3.5" />}
            disabled={pending}
            tone="ghost"
          >
            Comment
          </DecisionButton>
          <DecisionButton
            onClick={() => handleDecision('request-changes')}
            icon={<SendIcon className="size-3.5" />}
            disabled={pending}
            tone="warn"
          >
            Request changes
          </DecisionButton>
          <DecisionButton
            onClick={() => handleDecision('approve')}
            icon={<CheckIcon className="size-3.5" />}
            disabled={pending}
            tone="primary"
          >
            Approve
          </DecisionButton>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/60">
          {t('review.summary.shortcutHint' as DiffReviewKey)}
        </p>
      </PopoverContent>
    </Popover>
  )
}

function DecisionButton({
  onClick,
  icon,
  disabled,
  tone,
  children,
}: {
  onClick: () => void
  icon: React.ReactNode
  disabled?: boolean
  tone: 'ghost' | 'warn' | 'primary'
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-7 gap-1 rounded-md px-2 text-[11px] disabled:opacity-50',
        tone === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        tone === 'warn' && 'border border-orange-500/40 bg-orange-500/10 text-orange-600 hover:bg-orange-500/15 dark:text-orange-300',
        tone === 'ghost' && 'border border-border/60 bg-transparent text-foreground/80 hover:bg-muted',
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Button>
  )
}

function MenuCheck({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="h-auto w-full justify-start gap-2 rounded px-2 py-1 text-left text-[12px] font-normal text-foreground/80 hover:bg-muted disabled:opacity-50"
    >
      <span
        className={cn(
          'flex size-3.5 items-center justify-center rounded-[3px] border',
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}
      >
        {active && <CheckIcon className="size-2.5" />}
      </span>
      <span className="flex-1">{children}</span>
    </Button>
  )
}
