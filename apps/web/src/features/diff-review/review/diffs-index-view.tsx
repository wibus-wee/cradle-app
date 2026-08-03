import './review-surface.css'

import {
  CheckLine as CheckIcon,
  CloseLine as FailIcon,
  Folder2Line as LocalRepoIcon,
  GitBranchLine as BranchIcon,
  GithubLine as GithubIcon,
  GitPullRequestLine as PullRequestIcon,
  LoadingLine as RunningIcon,
  SearchLine as SearchIcon,
  User2Line as AuthorIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { cn } from '~/lib/cn'

import type { CradleDiffReview } from '../shared/types'
import { ChangeStat, StatusDot } from './review-primitives'
import {
  formatRelativeTime,
  reviewChecks,
  reviewIdentity,
  reviewStatusBadge,
} from './review-summary'

/**
 * A repository as the Diffs surface understands it: a code identity that owns
 * its reviews, whether or not it is checked out locally.
 *
 * Until the server's repository record is wired end-to-end, containers derive
 * this from workspace git checkouts plus review/GitHub identities, and carry
 * `workspaceId` / `repositoryPath` so navigation stays reachable.
 */
export interface RepositoryScope {
  id: string
  hostKind: 'github' | 'local'
  /** `owner/name` for a GitHub repository, the directory name for a local one. */
  label: string
  /** Absolute checkout path, when this repository is checked out locally. */
  localRoot: string | null
  reviewCount: number
  /** Workspace that can materialize reviews for this repository today. */
  workspaceId: string
  /** Relative path within the workspace; null for remote-only GitHub identities. */
  repositoryPath: string | null
}

type IndexTab = 'all' | 'open' | 'mine' | 'closed'

const TABS: Array<{ id: IndexTab, label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'For me' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
]

function matchesTab(review: CradleDiffReview, tab: IndexTab): boolean {
  if (tab === 'all') {
    return true
  }
  if (tab === 'closed') {
    return review.status !== 'open'
  }
  if (tab === 'open') {
    return review.status === 'open'
  }
  return review.status === 'open'
    && (review.reviewState === 'changes-requested'
      || review.threads.some(thread => thread.state !== 'resolved')
      || review.files.some(file => !file.isViewed))
}

function sourceKindLabel(sourceKind: CradleDiffReview['sourceKind']): string {
  switch (sourceKind) {
    case 'github-pull-request':
      return 'Pull request'
    case 'local-working-tree':
      return 'Working tree'
    case 'local-branch-compare':
      return 'Branch compare'
    case 'local-commit':
      return 'Commit'
    case 'agent-change-set':
      return 'Agent changes'
    case 'external-import':
      return 'Imported'
    default:
      return 'Review'
  }
}

function MetaSep() {
  return <span aria-hidden className="text-[var(--rv-fg-subtle)]/70">·</span>
}

function MetaItem({ children, className }: { children: ReactNode, className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {children}
    </span>
  )
}

function RepositoryRow({ repository, selected, onSelect }: {
  repository: RepositoryScope
  selected: boolean
  onSelect: () => void
}) {
  const Icon = repository.hostKind === 'github' ? GithubIcon : LocalRepoIcon
  const secondary = repository.localRoot
    ?? (repository.hostKind === 'github' ? 'GitHub' : 'Local')

  return (
    <li className="relative">
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-[6px] left-0 w-[2px] rounded-r-full bg-[var(--rv-accent)]"
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        title={repository.localRoot ?? repository.label}
        className={cn(
          'flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100',
          selected ? 'bg-[var(--rv-bg-active)]' : 'hover:bg-[var(--rv-bg-hover)]',
        )}
      >
        <Icon
          className={cn(
            'size-4 shrink-0',
            selected ? 'text-[var(--rv-fg)]' : 'text-[var(--rv-fg-subtle)]',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[13.5px] leading-snug',
              selected ? 'font-medium text-[var(--rv-fg)]' : 'text-[var(--rv-fg-muted)]',
            )}
          >
            {repository.label}
          </span>
          <span
            className="mt-0.5 block truncate font-[var(--rv-font-mono)] text-[11px] leading-tight text-[var(--rv-fg-subtle)]"
            title={secondary}
          >
            {secondary}
          </span>
        </span>
        <span data-rv-num className="shrink-0 self-start pt-0.5 text-[12px] text-[var(--rv-fg-subtle)]">
          {repository.reviewCount}
        </span>
      </button>
    </li>
  )
}

function ReviewRow({ review, onOpen }: { review: CradleDiffReview, onOpen: () => void }) {
  const identity = reviewIdentity(review)
  const status = reviewStatusBadge(review)
  const checks = reviewChecks(review)
  const revision = review.currentRevision
  const detail = review.githubPullRequest?.detail
  const openThreads = review.threads.filter(thread => thread.state !== 'resolved').length
  const unviewedFiles = review.files.filter(file => !file.isViewed).length
  const author = detail?.author?.login ?? null
  const labels = detail?.labels.slice(0, 3) ?? []
  const extraLabelCount = detail ? Math.max(0, detail.labels.length - labels.length) : 0

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group/row flex w-full items-start gap-3 px-4 py-3 text-left',
          'border-b border-[var(--rv-line)] transition-colors duration-100',
          'hover:bg-[var(--rv-bg-hover)]',
        )}
      >
        <StatusDot tone={status.tone} filled={status.filled} className="mt-[7px]" />

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2.5">
            {identity.reference && (
              <span
                data-rv-num
                className="shrink-0 font-[var(--rv-font-mono)] text-[12.5px] text-[var(--rv-fg-subtle)]"
              >
                {identity.reference}
              </span>
            )}
            <span className="min-w-0 truncate text-[14px] font-medium leading-snug text-[var(--rv-fg)]">
              {identity.title}
            </span>
          </span>

          {/* Second line carries the scan-worthy facts the single-line row left empty. */}
          <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--rv-fg-subtle)]">
            <MetaItem>
              <span className="text-[var(--rv-fg-muted)]">{status.label}</span>
            </MetaItem>

            {author && (
              <>
                <MetaSep />
                <MetaItem>
                  <AuthorIcon className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{author}</span>
                </MetaItem>
              </>
            )}

            {!detail && (
              <>
                <MetaSep />
                <MetaItem>{sourceKindLabel(review.sourceKind)}</MetaItem>
              </>
            )}

            {detail && (
              <>
                <MetaSep />
                <MetaItem className="max-w-[220px] font-[var(--rv-font-mono)] text-[11.5px]">
                  <BranchIcon className="size-3 shrink-0" aria-hidden />
                  <span className="truncate" title={`${detail.headRef} → ${detail.baseRef}`}>
                    {detail.headRef}
                    <span className="text-[var(--rv-fg-subtle)]"> → </span>
                    {detail.baseRef}
                  </span>
                </MetaItem>
              </>
            )}

            {checks && (
              <>
                <MetaSep />
                <MetaItem
                  className={cn(
                    checks.failed > 0 && 'text-[var(--rv-danger)]',
                    checks.failed === 0 && checks.pending > 0 && 'text-[var(--rv-warn)]',
                    checks.failed === 0 && checks.pending === 0 && 'text-[var(--rv-open)]',
                  )}
                >
                  {checks.failed > 0
                    ? <FailIcon className="size-3 shrink-0" aria-hidden />
                    : checks.pending > 0
                      ? <RunningIcon className="size-3 shrink-0 animate-spin" aria-hidden />
                      : <CheckIcon className="size-3 shrink-0" aria-hidden />}
                  <span data-rv-num>{checks.label}</span>
                </MetaItem>
              </>
            )}

            {openThreads > 0 && (
              <>
                <MetaSep />
                <MetaItem className="text-[var(--rv-warn)]">
                  <span data-rv-num>
                    {openThreads}
                    {openThreads === 1 ? ' unresolved' : ' unresolved'}
                  </span>
                </MetaItem>
              </>
            )}

            {unviewedFiles > 0 && review.files.length > 0 && (
              <>
                <MetaSep />
                <MetaItem>
                  <span data-rv-num>
                    {unviewedFiles}
                    {' / '}
                    {review.files.length}
                    {' unviewed'}
                  </span>
                </MetaItem>
              </>
            )}

            {labels.map(label => (
              <span
                key={label.name}
                className={cn(
                  'inline-flex h-[18px] items-center gap-1 rounded-[4px] px-1.5',
                  'border border-[var(--rv-line)] text-[10.5px] text-[var(--rv-fg-muted)]',
                )}
              >
                <span
                  aria-hidden
                  className="size-[6px] rounded-full"
                  style={{ background: `#${label.color}` }}
                />
                {label.name}
              </span>
            ))}
            {extraLabelCount > 0 && (
              <span data-rv-num className="text-[11px] text-[var(--rv-fg-subtle)]">
                +
                {extraLabelCount}
              </span>
            )}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5 text-[12px] text-[var(--rv-fg-subtle)]">
          {revision && (
            <ChangeStat
              additions={revision.additions}
              deletions={revision.deletions}
              className="justify-end text-[12px]"
            />
          )}
          <span className="flex items-center gap-2">
            {revision && (
              <span data-rv-num>
                {revision.fileCount}
                {revision.fileCount === 1 ? ' file' : ' files'}
              </span>
            )}
            <span
              data-rv-num
              title={new Date(review.updatedAt * 1000).toLocaleString()}
            >
              {formatRelativeTime(review.updatedAt)}
            </span>
          </span>
        </span>
      </button>
    </li>
  )
}

export interface DiffsIndexViewProps {
  repositories: RepositoryScope[]
  selectedRepositoryId: string | null
  onSelectRepository: (repositoryId: string) => void
  /** Reviews belonging to the selected repository, newest first. */
  reviews: CradleDiffReview[]
  loading?: boolean
  onOpenReview: (review: CradleDiffReview) => void
  onOpenWorkingTree?: () => void
  onAddPullRequest?: () => void
}

/**
 * The Diffs index.
 *
 * Repository-first: the left rail lists code identities, and the main column
 * lists only the reviews that belong to the selected one. A pull request can
 * never appear under a project it has nothing to do with, because the project
 * is not what owns it.
 */
export function DiffsIndexView({
  repositories,
  selectedRepositoryId,
  onSelectRepository,
  reviews,
  loading = false,
  onOpenReview,
  onOpenWorkingTree,
  onAddPullRequest,
}: DiffsIndexViewProps) {
  const [tab, setTab] = useState<IndexTab>('open')
  const [query, setQuery] = useState('')

  const selectedRepository = repositories.find(item => item.id === selectedRepositoryId) ?? null

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return reviews
      .filter(review => matchesTab(review, tab))
      .filter(review => !needle || review.title.toLowerCase().includes(needle))
  }, [query, reviews, tab])

  const counts = useMemo(() => ({
    open: reviews.filter(review => matchesTab(review, 'open')).length,
    mine: reviews.filter(review => matchesTab(review, 'mine')).length,
    closed: reviews.filter(review => matchesTab(review, 'closed')).length,
    all: reviews.length,
  }), [reviews])

  return (
    <div
      data-review-surface
      data-testid="diffs-index-view"
      className="flex h-full min-h-0 w-full overflow-hidden"
    >
      <aside
        className="flex w-[280px] shrink-0 flex-col border-r border-[var(--rv-line)] bg-[var(--rv-bg-subtle)]"
        aria-label="Repositories"
      >
        <div className="flex h-[var(--rv-topbar-h)] shrink-0 items-center px-4">
          <h1 className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--rv-fg)]">Diffs</h1>
        </div>

        <div className="flex items-center justify-between px-4 pb-1.5 pt-1">
          <h2 className="text-[10.5px] font-medium uppercase tracking-[0.055em] text-[var(--rv-fg-subtle)]">
            Repositories
          </h2>
          <span data-rv-num className="text-[11px] text-[var(--rv-fg-subtle)]">
            {repositories.length}
          </span>
        </div>

        <ul role="list" className="min-h-0 flex-1 overflow-y-auto pb-3">
          {repositories.map(repository => (
            <RepositoryRow
              key={repository.id}
              repository={repository}
              selected={repository.id === selectedRepositoryId}
              onSelect={() => onSelectRepository(repository.id)}
            />
          ))}
          {repositories.length === 0 && (
            <li className="px-4 py-6 text-[11.5px] text-[var(--rv-fg-subtle)]">
              No repositories yet. Open a project or add a pull request.
            </li>
          )}
        </ul>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--rv-bg)]">
        <header
          className={cn(
            'flex h-[var(--rv-topbar-h)] shrink-0 items-center gap-3 px-4',
            'border-b border-[var(--rv-line)]',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {selectedRepository?.hostKind === 'github' && (
              <GithubIcon className="size-3.5 shrink-0 text-[var(--rv-fg-subtle)]" aria-hidden />
            )}
            <h2 className="min-w-0 truncate text-[13px] font-semibold text-[var(--rv-fg)]">
              {selectedRepository?.label ?? 'No repository selected'}
            </h2>
            {selectedRepository?.localRoot && (
              <span
                className="hidden min-w-0 truncate font-[var(--rv-font-mono)] text-[11px] text-[var(--rv-fg-subtle)] md:inline"
                title={selectedRepository.localRoot}
              >
                {selectedRepository.localRoot}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex h-7 items-center gap-1.5 rounded-[var(--rv-radius)] bg-[var(--rv-bg-inset)] px-2">
              <SearchIcon className="size-3.5 shrink-0 text-[var(--rv-fg-subtle)]" aria-hidden />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search reviews"
                aria-label="Search reviews"
                className={cn(
                  'w-36 bg-transparent text-[12px] text-[var(--rv-fg)]',
                  'placeholder:text-[var(--rv-fg-subtle)] focus:outline-none',
                )}
              />
            </div>

            {onOpenWorkingTree && (
              <button
                type="button"
                onClick={onOpenWorkingTree}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-[var(--rv-radius)] px-2.5',
                  'border border-[var(--rv-line)] text-[11.5px] font-medium text-[var(--rv-fg-muted)]',
                  'transition-colors duration-100 hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]',
                )}
              >
                <BranchIcon className="size-3.5" aria-hidden />
                Working tree
              </button>
            )}

            {onAddPullRequest && (
              <button
                type="button"
                onClick={onAddPullRequest}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-[var(--rv-radius)] px-2.5',
                  'bg-[var(--rv-accent)] text-[11.5px] font-medium text-[var(--rv-accent-fg)]',
                  'transition-opacity duration-100 hover:opacity-90',
                )}
              >
                <PullRequestIcon className="size-3.5" aria-hidden />
                Add pull request
              </button>
            )}
          </div>
        </header>

        <nav
          className="flex h-9 shrink-0 items-center gap-4 border-b border-[var(--rv-line)] px-4"
          aria-label="Review filters"
        >
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id}
              className={cn(
                'relative flex h-9 items-center gap-1.5 text-[12px] transition-colors duration-100',
                tab === item.id
                  ? 'font-medium text-[var(--rv-fg)]'
                  : 'text-[var(--rv-fg-muted)] hover:text-[var(--rv-fg)]',
              )}
            >
              {item.label}
              <span data-rv-num className="text-[11px] text-[var(--rv-fg-subtle)]">
                {counts[item.id]}
              </span>
              {tab === item.id && (
                <span aria-hidden className="absolute inset-x-0 -bottom-px h-[1.5px] bg-[var(--rv-fg)]" />
              )}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <p className="px-4 py-6 text-[12px] text-[var(--rv-fg-subtle)]">Loading reviews…</p>
          )}

          {!loading && visible.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 px-4 py-16 text-center">
              <p className="text-[13px] font-medium text-[var(--rv-fg)]">
                {query ? `No review matches “${query}”` : 'Nothing to review'}
              </p>
              <p className="max-w-[42ch] text-[12px] text-[var(--rv-fg-muted)]">
                {query
                  ? 'Try a different search, or switch tabs.'
                  : 'Open the working tree to review uncommitted changes, or add a pull request to review it here.'}
              </p>
            </div>
          )}

          {!loading && visible.length > 0 && (
            <ul role="list">
              {visible.map(review => (
                <ReviewRow key={review.id} review={review} onOpen={() => onOpenReview(review)} />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  )
}
