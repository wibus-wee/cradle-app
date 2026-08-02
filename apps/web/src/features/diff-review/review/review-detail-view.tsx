import './review-surface.css'

import {
  AlignLeftLine as UnifiedIcon,
  ArrowLeftLine as BackIcon,
  Chat1Line as ThreadsIcon,
  Columns3Line as SplitIcon,
  DownLine as ExpandIcon,
  GithubLine as GithubIcon,
  Refresh2Line as RefreshIcon,
  RobotLine as AgentIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

import type { CradleDiffReview, DiffStyle, ReviewDecision, ReviewFile } from '../shared/types'
import { ReviewFileRail } from './review-file-rail'
import { ReviewOverview } from './review-overview'
import { IconAction, StatusDot } from './review-primitives'
import { reviewIdentity, reviewStatusBadge } from './review-summary'

/** Two-state segmented control. Sized to sit inside the 44px bar without crowding it. */
function DiffStyleToggle({ value, onChange }: { value: DiffStyle, onChange: (style: DiffStyle) => void }) {
  return (
    <div
      role="group"
      aria-label="Diff layout"
      className="flex h-7 items-center gap-0.5 rounded-[var(--rv-radius)] bg-[var(--rv-bg-inset)] p-0.5"
    >
      {([
        ['unified', UnifiedIcon, 'Unified'],
        ['split', SplitIcon, 'Split'],
      ] as const).map(([style, Icon, label]) => (
        <button
          key={style}
          type="button"
          title={`${label} diff`}
          aria-label={`${label} diff`}
          aria-pressed={value === style}
          onClick={() => onChange(style)}
          className={cn(
            'inline-flex h-6 w-7 items-center justify-center rounded-[4px] transition-colors duration-100',
            value === style
              ? 'bg-[var(--rv-bg-raised)] text-[var(--rv-fg)] shadow-[var(--rv-shadow-raised)]'
              : 'text-[var(--rv-fg-subtle)] hover:text-[var(--rv-fg-muted)]',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  )
}

export interface ReviewDetailViewProps {
  review: CradleDiffReview
  /** Files after the review's hide/collapse preferences are applied. */
  files: ReviewFile[]
  hiddenFileCount?: number
  selectedFileId: string | null
  onSelectFile: (file: ReviewFile) => void
  onToggleViewed: (file: ReviewFile) => void
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  overviewCollapsed: boolean
  onToggleOverview: () => void
  onBack: () => void
  onRefresh: () => void
  refreshPending?: boolean
  onSubmit: (decision: ReviewDecision) => void
  submitPending?: boolean
  threadsOpen: boolean
  onToggleThreads: () => void
  /** Optional agent-rail toggle; when omitted the control is hidden. */
  agentOpen?: boolean
  onToggleAgent?: () => void
  agentFixCount?: number
  /**
   * Extra header controls (display prefs, GitHub merge, close, …) rendered
   * before the primary submit control. Keeps the View free of product mutations.
   */
  extraActions?: ReactNode
  /**
   * Replaces the default Approve button when the container needs the full
   * review popover (approve / request changes / comment).
   */
  submitControl?: ReactNode
  railWidth?: number
  /** The diff itself, supplied by the container so this View stays runtime-free. */
  diffSlot: ReactNode
  /** Open-thread / agent list rendered as an overlay sheet, not a permanent column. */
  threadsSlot?: ReactNode
}

/**
 * The review reading surface.
 *
 * Two regions, not three: an index of what changed, and the change itself.
 * Threads arrive as an overlay rather than a standing column, because a diff
 * that is permanently squeezed between two panels is the thing reviewers
 * actually complain about — the code should get the width by default and give
 * it up only when you ask for something else.
 */
export function ReviewDetailView({
  review,
  files,
  hiddenFileCount = 0,
  selectedFileId,
  onSelectFile,
  onToggleViewed,
  diffStyle,
  onDiffStyleChange,
  overviewCollapsed,
  onToggleOverview,
  onBack,
  onRefresh,
  refreshPending = false,
  onSubmit,
  submitPending = false,
  threadsOpen,
  onToggleThreads,
  agentOpen = false,
  onToggleAgent,
  agentFixCount = 0,
  extraActions,
  submitControl,
  railWidth = 248,
  diffSlot,
  threadsSlot,
}: ReviewDetailViewProps) {
  const identity = reviewIdentity(review)
  const status = reviewStatusBadge(review)
  const openThreads = review.threads.filter(thread => thread.state !== 'resolved').length

  return (
    <div
      data-review-surface
      data-testid="review-detail-view"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <header
        className={cn(
          'flex h-[var(--rv-topbar-h)] shrink-0 items-center gap-1 px-2.5',
          'border-b border-[var(--rv-line)] bg-[var(--rv-bg)]',
        )}
      >
        <IconAction label="Back to reviews" onClick={onBack}>
          <BackIcon className="size-4" aria-hidden />
        </IconAction>

        <div className="ml-1 flex min-w-0 flex-1 items-center gap-2">
          {identity.hostKind === 'github' && (
            <GithubIcon className="size-3.5 shrink-0 text-[var(--rv-fg-subtle)]" aria-hidden />
          )}
          <span className="shrink-0 text-[12px] font-medium text-[var(--rv-fg-muted)]">
            {identity.repositoryLabel}
          </span>
          {identity.reference && (
            <span data-rv-num className="shrink-0 font-[var(--rv-font-mono)] text-[12px] text-[var(--rv-fg-subtle)]">
              {identity.reference}
            </span>
          )}

          {/* When the overview is hidden the bar becomes the title, so the page
              never loses its subject while scrolling deep into a diff. */}
          {overviewCollapsed && (
            <>
              <span aria-hidden className="shrink-0 text-[var(--rv-fg-subtle)]">/</span>
              <StatusDot tone={status.tone} filled={status.filled} />
              <span className="min-w-0 truncate text-[12.5px] font-medium text-[var(--rv-fg)]">
                {identity.title}
              </span>
              <button
                type="button"
                onClick={onToggleOverview}
                title="Show details"
                aria-label="Show details"
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-[4px]',
                  'text-[var(--rv-fg-subtle)] transition-colors duration-100',
                  'hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
                )}
              >
                <ExpandIcon className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <DiffStyleToggle value={diffStyle} onChange={onDiffStyleChange} />

          <IconAction label="Refresh" onClick={onRefresh} disabled={refreshPending}>
            <RefreshIcon className={cn('size-4', refreshPending && 'animate-spin')} aria-hidden />
          </IconAction>

          {extraActions}

          <button
            type="button"
            onClick={onToggleThreads}
            aria-pressed={threadsOpen && !agentOpen}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[var(--rv-radius)] px-2',
              'text-[11.5px] font-medium transition-colors duration-100',
              threadsOpen && !agentOpen
                ? 'bg-[var(--rv-bg-active)] text-[var(--rv-fg)]'
                : 'text-[var(--rv-fg-muted)] hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
            )}
          >
            <ThreadsIcon className="size-3.5" aria-hidden />
            <span data-rv-num>{openThreads}</span>
          </button>

          {onToggleAgent && (
            <button
              type="button"
              onClick={onToggleAgent}
              aria-pressed={agentOpen}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-[var(--rv-radius)] px-2',
                'text-[11.5px] font-medium transition-colors duration-100',
                agentOpen
                  ? 'bg-[var(--rv-bg-active)] text-[var(--rv-fg)]'
                  : 'text-[var(--rv-fg-muted)] hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
              )}
            >
              <AgentIcon className="size-3.5" aria-hidden />
              <span data-rv-num>{agentFixCount}</span>
            </button>
          )}

          <span aria-hidden className="mx-1 h-4 w-px bg-[var(--rv-line)]" />

          {submitControl ?? (
            <button
              type="button"
              onClick={() => onSubmit('approve')}
              disabled={submitPending}
              className={cn(
                'inline-flex h-7 items-center rounded-[var(--rv-radius)] px-2.5',
                'bg-[var(--rv-accent)] text-[11.5px] font-medium text-[var(--rv-accent-fg)]',
                'transition-opacity duration-100 hover:opacity-90',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              Approve
            </button>
          )}
        </div>
      </header>

      <ReviewOverview
        review={review}
        collapsed={overviewCollapsed}
        onToggleCollapsed={onToggleOverview}
      />

      <div className="relative flex min-h-0 flex-1">
        <ReviewFileRail
          files={files}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
          onToggleViewed={onToggleViewed}
          hiddenFileCount={hiddenFileCount}
          width={railWidth}
        />

        <main data-rv-code className="min-h-0 min-w-0 flex-1 bg-[var(--rv-bg)]">
          {diffSlot}
        </main>

        {threadsOpen && threadsSlot && (
          <div
            className={cn(
              'absolute inset-y-0 right-0 z-20 w-[340px] max-w-[80%]',
              'border-l border-[var(--rv-edge)] bg-[var(--rv-bg-raised)]',
              'shadow-[var(--rv-shadow-pop)]',
              'motion-safe:animate-in motion-safe:slide-in-from-right-2 motion-safe:duration-150',
            )}
            role="complementary"
            aria-label={agentOpen ? 'Agent fixes' : 'Review threads'}
          >
            {threadsSlot}
          </div>
        )}
      </div>
    </div>
  )
}
