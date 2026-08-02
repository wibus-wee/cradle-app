import './review-surface.css'

import {
  AlignLeftLine as UnifiedIcon,
  ArrowLeftLine as BackIcon,
  Columns3Line as SplitIcon,
  GitBranchLine as BranchIcon,
  GitCommitLine as CommitIcon,
  Refresh2Line as RefreshIcon,
  SparklesLine as AgentIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

import type { DiffStyle } from '../shared/types'
import { IconAction } from './review-primitives'
import type { WorkingTreeFile, WorkingTreeModel } from './working-tree-model'
import { canCommit, partitionByStage, workingTreeTotals } from './working-tree-model'
import { StagingGroup } from './working-tree-staging'

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

export interface WorkingTreeViewProps {
  model: WorkingTreeModel
  selectedFileId: string | null
  onSelectFile: (file: WorkingTreeFile) => void
  onToggleStage: (file: WorkingTreeFile) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onDiscard: (file: WorkingTreeFile) => void
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  /** Commit subject line, owned by the container so the composer stays controlled. */
  commitSubject: string
  onCommitSubjectChange: (subject: string) => void
  onCommit: () => void
  commitPending?: boolean
  onBack: () => void
  onRefresh: () => void
  refreshPending?: boolean
  /** Hand the staged (or selected) change to an agent instead of committing it. */
  onAskAgent?: () => void
  railWidth?: number
  diffSlot: ReactNode
}

/**
 * The local-changes surface.
 *
 * A staging-and-commit panel, not a review: the left rail lets you choose what
 * goes into the next commit, the composer at its foot writes the message, and
 * the button commits. The diff on the right is what you are deciding about. The
 * only escape hatch from "commit it yourself" is handing the change to an
 * agent — no approve, no reviewers, no review state, because none of those mean
 * anything for code you have not committed.
 */
export function WorkingTreeView({
  model,
  selectedFileId,
  onSelectFile,
  onToggleStage,
  onStageAll,
  onUnstageAll,
  onDiscard,
  diffStyle,
  onDiffStyleChange,
  commitSubject,
  onCommitSubjectChange,
  onCommit,
  commitPending = false,
  onBack,
  onRefresh,
  refreshPending = false,
  onAskAgent,
  railWidth = 300,
  diffSlot,
}: WorkingTreeViewProps) {
  const totals = workingTreeTotals(model)
  const { staged, unstaged } = partitionByStage(model.files)
  const committable = canCommit(model, commitSubject)
  const clean = model.files.length === 0

  return (
    <div
      data-review-surface
      data-testid="working-tree-view"
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
          <span className="shrink-0 text-[12px] font-medium text-[var(--rv-fg-muted)]">
            {model.repositoryLabel}
          </span>
          <span aria-hidden className="shrink-0 text-[var(--rv-fg-subtle)]">/</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <BranchIcon className="size-3.5 shrink-0 text-[var(--rv-fg-subtle)]" aria-hidden />
            <span className="truncate font-[var(--rv-font-mono)] text-[12px] text-[var(--rv-fg)]" title={model.branch}>
              {model.branch}
            </span>
          </span>
          {model.upstream && (model.upstream.ahead > 0 || model.upstream.behind > 0) && (
            <span data-rv-num className="shrink-0 font-[var(--rv-font-mono)] text-[11px] text-[var(--rv-fg-subtle)]">
              {model.upstream.ahead > 0 && `↑${model.upstream.ahead}`}
              {model.upstream.behind > 0 && ` ↓${model.upstream.behind}`}
            </span>
          )}
          <span aria-hidden className="mx-0.5 h-3.5 w-px bg-[var(--rv-line)]" />
          <span data-rv-num className="shrink-0 text-[11.5px] text-[var(--rv-fg-subtle)]">
            {totals.files === 0
              ? 'No changes'
              : `${totals.files} changed`}
          </span>
          {totals.files > 0 && (
            <span data-rv-num className="shrink-0 text-[11.5px]">
              <span className="text-[var(--rv-add)]">
                +
                {totals.additions}
              </span>
              {' '}
              <span className="text-[var(--rv-del)]">
                −
                {totals.deletions}
              </span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <DiffStyleToggle value={diffStyle} onChange={onDiffStyleChange} />
          <IconAction label="Refresh" onClick={onRefresh} disabled={refreshPending}>
            <RefreshIcon className={cn('size-4', refreshPending && 'animate-spin')} aria-hidden />
          </IconAction>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex min-h-0 shrink-0 flex-col border-r border-[var(--rv-line)] bg-[var(--rv-bg-subtle)]"
          style={{ width: railWidth }}
          aria-label="Working tree changes"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            {clean
              ? (
                  <div className="flex flex-col items-center gap-1.5 px-4 py-16 text-center">
                    <p className="text-[12.5px] font-medium text-[var(--rv-fg)]">Working tree clean</p>
                    <p className="max-w-[30ch] text-[11.5px] text-[var(--rv-fg-muted)]">
                      Nothing to commit. Edits you or an agent make will show up here.
                    </p>
                  </div>
                )
              : (
                  <>
                    <StagingGroup
                      title="Staged"
                      files={staged}
                      selectedFileId={selectedFileId}
                      onSelectFile={onSelectFile}
                      onToggleStage={onToggleStage}
                      onBulk={staged.length > 0 ? onUnstageAll : undefined}
                      bulkLabel="Unstage all"
                    />
                    <StagingGroup
                      title="Changes"
                      files={unstaged}
                      selectedFileId={selectedFileId}
                      onSelectFile={onSelectFile}
                      onToggleStage={onToggleStage}
                      onDiscard={onDiscard}
                      onBulk={unstaged.length > 0 ? onStageAll : undefined}
                      bulkLabel="Stage all"
                    />
                  </>
                )}
          </div>

          {/* Commit composer docked at the foot of the rail: message, then the
              single primary action of this whole surface. Gone entirely when the
              tree is clean — a disabled commit box for "nothing to commit" is
              just furniture. */}
          {!clean && (
          <div className="shrink-0 border-t border-[var(--rv-line)] bg-[var(--rv-bg)] p-2.5">
            <textarea
              value={commitSubject}
              onChange={event => onCommitSubjectChange(event.target.value)}
              placeholder="Commit message"
              rows={2}
              disabled={clean}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && committable) {
                  event.preventDefault()
                  onCommit()
                }
              }}
              className={cn(
                'w-full resize-none rounded-[var(--rv-radius)] border border-[var(--rv-line)] bg-[var(--rv-bg-raised)]',
                'px-2.5 py-2 text-[12px] leading-[1.5] text-[var(--rv-fg)]',
                'placeholder:text-[var(--rv-fg-subtle)]',
                'focus:border-[var(--rv-accent)] focus:outline-none',
                'disabled:opacity-50',
              )}
            />

            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={onCommit}
                disabled={!committable || commitPending}
                className={cn(
                  'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--rv-radius)]',
                  'bg-[var(--rv-accent)] text-[12px] font-medium text-[var(--rv-accent-fg)]',
                  'transition-opacity duration-100 hover:opacity-90',
                  'disabled:pointer-events-none disabled:opacity-40',
                )}
              >
                <CommitIcon className="size-3.5" aria-hidden />
                {totals.staged > 0
                  ? `Commit ${totals.staged} file${totals.staged === 1 ? '' : 's'}`
                  : 'Commit'}
              </button>

              {onAskAgent && (
                <button
                  type="button"
                  onClick={onAskAgent}
                  disabled={clean}
                  title="Hand these changes to an agent"
                  className={cn(
                    'inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--rv-radius)]',
                    'border border-[var(--rv-line)] text-[var(--rv-fg-muted)]',
                    'transition-colors duration-100 hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
                    'disabled:pointer-events-none disabled:opacity-40',
                  )}
                >
                  <AgentIcon className="size-4" aria-hidden />
                </button>
              )}
            </div>

            <p className="mt-1.5 px-0.5 text-[10.5px] text-[var(--rv-fg-subtle)]">
              {committable
                ? (
<>
Committing to
<span className="font-[var(--rv-font-mono)]">{model.branch}</span>
{' '}
· ⌘↵
</>
)
                : totals.staged === 0
                  ? 'Stage a file to commit'
                  : 'Write a message to commit'}
            </p>
          </div>
          )}
        </aside>

        <main data-rv-code className="min-h-0 min-w-0 flex-1 bg-[var(--rv-bg)]">
          {clean
            ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-[12.5px] text-[var(--rv-fg-subtle)]">
                    No changes on
                    {' '}
                    <span className="font-[var(--rv-font-mono)]">{model.branch}</span>
                  </p>
                </div>
              )
            : diffSlot}
        </main>
      </div>
    </div>
  )
}
