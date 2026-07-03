import {
  DownSmallLine as ChevronDownIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as GitCompareIcon,
  GitPullRequestLine as GitPullRequestIcon,
  PlusLine as PlusIcon,
  RightSmallLine as ChevronRightIcon,
  Search2Line as SearchIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompare,
  postWorkspacesByWorkspaceIdDiffReviewsLocalCommit,
} from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { GitRefPicker } from './git-ref-picker'
import {
  reviewListQueryKey,
  sourceLabel,
} from './shared/diff-items'
import { navigateToReview } from './shared/navigation'
import type { CradleDiffReview } from './shared/types'
import { WORKING_TREE_REVIEW_ID } from './shared/types'
import type { ReviewsListTab } from './shared/use-review-list'
import { useReviewList } from './shared/use-review-list'
import { SOURCE_KIND_ICONS, statusGlyph } from './source-kind'

type DiffReviewKey = keyof typeof import('~/locales/default').default['diff-review']

interface ReviewsListPageProps {
  workspaceId: string
  repositoryPath?: string | null
}

const LIST_TABS: Array<{ id: ReviewsListTab, label: string }> = [
  { id: 'for-me', label: 'For me' },
  { id: 'created', label: 'Created' },
  { id: 'all', label: 'All' },
]

export function ReviewsListPage({
  workspaceId,
  repositoryPath,
}: ReviewsListPageProps) {
  const { reviews, isLoading, isError, countForTab, groupsForTab } = useReviewList(workspaceId)
  const [tab, setTab] = useState<ReviewsListTab>('for-me')
  const [query, setQuery] = useState('')
  const queryClient = useQueryClient()

  const compareMutation = useMutation({
    mutationFn: async (input: { baseRef: string, headRef: string }) => {
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompare({
        path: { workspaceId },
        body: {
          repo: repositoryPath ?? undefined,
          baseRef: input.baseRef,
          headRef: input.headRef,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(workspaceId) })
      navigateToReview(workspaceId, data.id, { repositoryPath })
    },
  })

  const commitMutation = useMutation({
    mutationFn: async (input: { commitRef: string }) => {
      const { data } = await postWorkspacesByWorkspaceIdDiffReviewsLocalCommit({
        path: { workspaceId },
        body: {
          repo: repositoryPath ?? undefined,
          commitRef: input.commitRef,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(workspaceId) })
      navigateToReview(workspaceId, data.id, { repositoryPath })
    },
  })

  const visibleGroups = useMemo(() => {
    const groups = groupsForTab(tab)
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) {
      return groups
    }
    return groups
      .map(group => ({
        ...group,
        reviews: group.reviews.filter(review =>
          review.title.toLowerCase().includes(trimmed)
          || sourceLabel(review.sourceKind).toLowerCase().includes(trimmed)),
      }))
      .filter(group => group.reviews.length > 0)
  }, [groupsForTab, tab, query])

  const workingTreePresent = reviews.some(review => review.sourceKind === 'local-working-tree')
  const hasAnyReviews = reviews.length > 0
  const isFiltering = query.trim().length > 0

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background" data-testid="reviews-list-page">
      <Header
        workspaceId={workspaceId}
        count={reviews.length}
        query={query}
        onQueryChange={setQuery}
        onCompare={input => compareMutation.mutate(input)}
        comparePending={compareMutation.isPending}
        onCommit={input => commitMutation.mutate(input)}
        commitPending={commitMutation.isPending}
        repositoryPath={repositoryPath}
      />

      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-4">
        <TextTabs tab={tab} onChange={setTab} countForTab={countForTab} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading
          ? (
              <div className="flex h-full items-center justify-center py-20">
                <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
              </div>
            )
          : isError
            ? (
                <div className="py-20 text-center">
                  <p className="text-[12px] text-muted-foreground">Reviews unavailable</p>
                </div>
              )
            : (
                <ReviewsContent
                  workspaceId={workspaceId}
                  repositoryPath={repositoryPath}
                  hasAnyReviews={hasAnyReviews}
                  workingTreePresent={workingTreePresent}
                  visibleGroups={visibleGroups}
                  isFiltering={isFiltering}
                  onCompare={input => compareMutation.mutate(input)}
                  comparePending={compareMutation.isPending}
                />
              )}
      </div>
    </div>
  )
}

function Header({
  workspaceId,
  count,
  query,
  onQueryChange,
  onCompare,
  comparePending,
  onCommit,
  commitPending,
  repositoryPath,
}: {
  workspaceId: string
  count: number
  query: string
  onQueryChange: (value: string) => void
  onCompare: (input: { baseRef: string, headRef: string }) => void
  comparePending: boolean
  onCommit: (input: { commitRef: string }) => void
  commitPending: boolean
  repositoryPath?: string | null
}) {
  const { t } = useTranslation('diff-review')
  const { workspaces } = useWorkspaces()
  const workspace = workspaces.find(item => item.id === workspaceId)
  const inputRef = useRef<HTMLInputElement>(null)

  // Linear-style focus: ⌘K / Ctrl+K or "/" focuses the filter; Esc clears.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        return
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        if (query) {
          onQueryChange('')
        }
        else {
          inputRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [query, onQueryChange])

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="text-base font-semibold tracking-tight text-foreground">Reviews</h1>
        <span className="text-[12px] tabular-nums text-muted-foreground">{count}</span>
        {workspace && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="truncate text-[12px] text-muted-foreground">{workspace.name}</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      <div className="relative hidden sm:block">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={t('reviews.filter.placeholder' as DiffReviewKey)}
          className="h-8 w-56 rounded-lg border-border/60 bg-muted/30 pl-8 pr-10 text-[12px] shadow-none"
          aria-label={t('reviews.filter.placeholder' as DiffReviewKey)}
          data-testid="reviews-filter-input"
        />
        {!query && (
          <kbd
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/60"
            aria-hidden
          >
            {t('reviews.filter.shortcut' as DiffReviewKey)}
          </kbd>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-[12px]"
        onClick={() => navigateToReview(workspaceId, WORKING_TREE_REVIEW_ID, { repositoryPath })}
      >
        <PlusIcon className="size-3.5" aria-hidden />
        {t('reviews.workingTree.cta' as DiffReviewKey)}
      </Button>
      <CommitDialog
        workspaceId={workspaceId}
        repositoryPath={repositoryPath}
        onOpen={onCommit}
        pending={commitPending}
      />
      <CompareDialog
        workspaceId={workspaceId}
        repositoryPath={repositoryPath}
        onCompare={onCompare}
        pending={comparePending}
      />
    </header>
  )
}

function TextTabs({
  tab,
  onChange,
  countForTab,
}: {
  tab: ReviewsListTab
  onChange: (tab: ReviewsListTab) => void
  countForTab: (tab: ReviewsListTab) => number
}) {
  return (
    <div className="flex items-end gap-4">
      {LIST_TABS.map((item) => {
        const active = tab === item.id
        return (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(item.id)}
            className={cn(
              'relative h-9 gap-1.5 rounded-none px-0 text-[13px] focus-visible:ring-2 focus-visible:ring-ring/40',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            <span className="tabular-nums text-muted-foreground/70">{countForTab(item.id)}</span>
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-[1.5px] bg-foreground"
              />
            )}
          </Button>
        )
      })}
    </div>
  )
}

function ReviewsContent({
  workspaceId,
  repositoryPath,
  hasAnyReviews,
  workingTreePresent,
  visibleGroups,
  isFiltering,
  onCompare,
  comparePending,
}: {
  workspaceId: string
  repositoryPath?: string | null
  hasAnyReviews: boolean
  workingTreePresent: boolean
  visibleGroups: Array<{ id: string, label: string, reviews: CradleDiffReview[] }>
  isFiltering: boolean
  onCompare: (input: { baseRef: string, headRef: string }) => void
  comparePending: boolean
}) {
  const { t } = useTranslation('diff-review')

  // No reviews at all -> empty state. Keep the working-tree action visible because
  // the live working-tree review is materialized only after the user opens it.
  if (!hasAnyReviews) {
    return (
      <EmptyState
        workspaceId={workspaceId}
        repositoryPath={repositoryPath}
        onCompare={onCompare}
        comparePending={comparePending}
      />
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="px-4 pt-3 pb-2">
        <WorkingTreeCard
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          present={workingTreePresent}
        />
      </div>

      {visibleGroups.length === 0 && isFiltering
        ? (
            <div className="py-16 text-center">
              <SearchIcon className="mx-auto size-5 text-muted-foreground/30" aria-hidden />
              <p className="mt-2 text-[12px] text-muted-foreground">{t('reviews.empty.filterTitle' as DiffReviewKey)}</p>
            </div>
          )
        : visibleGroups.map(group => (
            <GroupSection key={group.id} group={group} workspaceId={workspaceId} repositoryPath={repositoryPath} />
          ))}
    </div>
  )
}

function EmptyState({
  workspaceId,
  repositoryPath,
  onCompare,
  comparePending,
}: {
  workspaceId: string
  repositoryPath?: string | null
  onCompare: (input: { baseRef: string, headRef: string }) => void
  comparePending: boolean
}) {
  const { t } = useTranslation('diff-review')
  return (
    <div className="mx-auto max-w-3xl px-4 pt-16">
      <Empty className="rounded-lg px-6 py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitPullRequestIcon className="size-5" aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('reviews.empty.title' as DiffReviewKey)}</EmptyTitle>
          <EmptyDescription>{t('reviews.empty.description' as DiffReviewKey)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button
            size="sm"
            className="h-8 gap-1.5 text-[12px]"
            onClick={() => navigateToReview(workspaceId, WORKING_TREE_REVIEW_ID, { repositoryPath })}
          >
            <PlusIcon className="size-3.5" aria-hidden />
            {t('reviews.workingTree.cta' as DiffReviewKey)}
          </Button>
          <CompareDialog
            workspaceId={workspaceId}
            repositoryPath={repositoryPath}
            onCompare={onCompare}
            pending={comparePending}
            triggerLabel={t('reviews.empty.compareCta' as DiffReviewKey)}
          />
        </EmptyContent>
      </Empty>
    </div>
  )
}

function WorkingTreeCard({
  workspaceId,
  repositoryPath,
  present,
}: {
  workspaceId: string
  repositoryPath?: string | null
  present: boolean
}) {
  const { t } = useTranslation('diff-review')
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => navigateToReview(workspaceId, WORKING_TREE_REVIEW_ID, { repositoryPath })}
      className={cn(
        'group h-auto w-full justify-start gap-3 rounded-lg border border-border/60 bg-card px-3.5 py-2.5 text-left font-normal whitespace-normal shadow-xs',
        'hover:!bg-card hover:border-border active:scale-[0.998]',
        'focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
      data-testid="reviews-working-tree-entry"
    >
      <span className="relative flex size-7 shrink-0 items-center justify-center text-foreground">
        {present && (
          <span className="absolute left-0 top-1/2 flex size-2 -translate-y-1/2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/30" />
            <span className="relative inline-flex size-2 rounded-full bg-foreground" />
          </span>
        )}
        <PlusIcon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 pl-1.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">Working tree</span>
          {present
            ? (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('reviews.live' as DiffReviewKey)}
                </span>
              )
            : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {present ? 'Review your uncommitted changes' : 'No uncommitted changes detected'}
        </span>
      </span>
      <ChevronRightIcon
        className="size-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}

function GroupSection({
  group,
  workspaceId,
  repositoryPath,
}: {
  group: { id: string, label: string, reviews: CradleDiffReview[] }
  workspaceId: string
  repositoryPath?: string | null
}) {
  const collapsed = useCollapsedGroup(workspaceId, group.id)
  const Icon = SOURCE_KIND_ICONS[group.reviews[0]?.sourceKind ?? 'local-commit']

  return (
    <section className="px-4 pb-2">
      <Button
        type="button"
        variant="ghost"
        onClick={() => collapsed.toggle()}
        aria-expanded={!collapsed.value}
        className="h-auto w-full justify-start gap-1.5 rounded-md px-1 py-2 text-left font-normal hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ChevronDownIcon
          className={cn('size-3.5 text-muted-foreground transition-transform', collapsed.value && '-rotate-90')}
          aria-hidden
        />
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground">
          {group.label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground/50">{group.reviews.length}</span>
      </Button>

      {!collapsed.value && (
        <ul role="list" className="divide-y divide-border/50">
          {group.reviews.map(review => (
            <li key={review.id}>
              <ReviewRow
                review={review}
                onClick={() => navigateToReview(workspaceId, review.id, { repositoryPath })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReviewRow({ review, onClick }: { review: CradleDiffReview, onClick: () => void }) {
  const openThreads = review.threads.filter(thread => thread.state === 'open').length
  const unviewed = review.files.filter(file => !file.isViewed).length
  const StatusIcon = statusGlyph(review).icon

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        'group h-auto w-full justify-start gap-3 rounded-none px-1 py-2 text-left font-normal hover:bg-transparent',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
      )}
      data-testid="reviews-list-row"
    >
      <StatusIcon className="size-4 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground/90 group-hover:text-foreground">{review.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
          <span className="truncate">{sourceLabel(review.sourceKind)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="tabular-nums">{fileCountLabel(review)}</span>
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
        <ChangeStats review={review} />
        {(unviewed > 0 || openThreads > 0) && (
          <span className="text-muted-foreground/40">·</span>
        )}
        {unviewed > 0 && <span className="text-muted-foreground">{`${unviewed} unviewed`}</span>}
        {openThreads > 0 && <span className="text-foreground/70">{`${openThreads} open`}</span>}
      </div>
    </Button>
  )
}

function fileCountLabel(review: CradleDiffReview): string {
  const revision = review.currentRevision
  if (!revision) {
    return '0 files'
  }
  return `${revision.fileCount} file${revision.fileCount === 1 ? '' : 's'}`
}

/** Monochrome `+a −d`, right-aligned, muted. No green/red this version. */
function ChangeStats({ review }: { review: CradleDiffReview }) {
  const revision = review.currentRevision
  if (!revision) {
    return null
  }
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className="text-muted-foreground/60">{`+${revision.additions}`}</span>
      <span className="text-muted-foreground/60">{`−${revision.deletions}`}</span>
    </span>
  )
}

const COLLAPSED_KEY = (workspaceId: string) => `cradle-diffs:collapsed:${workspaceId}`

/** Per-workspace collapsed-group state, persisted to localStorage. */
function useCollapsedGroup(workspaceId: string, groupId: string) {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY(workspaceId))
      if (!raw) {
        return false
      }
      const set = JSON.parse(raw) as string[]
      return set.includes(groupId)
    }
    catch {
      return false
    }
  })

  const toggle = () => {
    setValue((prev) => {
      const next = !prev
      try {
        const raw = window.localStorage.getItem(COLLAPSED_KEY(workspaceId))
        const set = raw ? (JSON.parse(raw) as string[]) : []
        const updated = next
          ? Array.from(new Set([...set, groupId]))
          : set.filter(id => id !== groupId)
        window.localStorage.setItem(COLLAPSED_KEY(workspaceId), JSON.stringify(updated))
      }
      catch {
        // ignore storage failures
      }
      return next
    })
  }

  return { value, toggle }
}

function CommitDialog({
  workspaceId,
  repositoryPath,
  onOpen,
  pending,
}: {
  workspaceId: string
  repositoryPath?: string | null
  onOpen: (input: { commitRef: string }) => void
  pending: boolean
}) {
  const { t } = useTranslation('diff-review')
  const [open, setOpen] = useState(false)
  const [commitRef, setCommitRef] = useState('')

  const reset = () => {
    setCommitRef('')
  }

  const submit = () => {
    if (!commitRef.trim() || pending) {
      return
    }
    onOpen({ commitRef: commitRef.trim() })
    setOpen(false)
    reset()
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset() } }}>
      <PopoverTrigger
        render={(
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
            <GitCommitIcon className="size-3.5" aria-hidden />
            Commit
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 gap-2 p-3">
        <GitRefPicker
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          value={commitRef}
          onValueChange={setCommitRef}
          autoFocus
          quickRefs={['HEAD', 'HEAD~1']}
          placeholder={t('reviews.commitRef.placeholder' as DiffReviewKey)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-[12px]" disabled={!commitRef.trim() || pending} onClick={submit}>
            {pending && <Spinner className="size-3.5" />}
            Open
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CompareDialog({
  workspaceId,
  repositoryPath,
  onCompare,
  pending,
  triggerLabel = 'Compare',
  asPrimary = false,
}: {
  workspaceId: string
  repositoryPath?: string | null
  onCompare: (input: { baseRef: string, headRef: string }) => void
  pending: boolean
  triggerLabel?: string
  asPrimary?: boolean
}) {
  const { t } = useTranslation('diff-review')
  const [open, setOpen] = useState(false)
  const [baseRef, setBaseRef] = useState('main')
  const [headRef, setHeadRef] = useState('')

  const reset = () => {
    setBaseRef('main')
    setHeadRef('')
  }

  const submit = () => {
    if (!baseRef.trim() || !headRef.trim() || pending) {
      return
    }
    onCompare({ baseRef: baseRef.trim(), headRef: headRef.trim() })
    setOpen(false)
    reset()
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset() } }}>
      <PopoverTrigger
        render={(
          <Button
            variant={asPrimary ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-[12px]"
          >
            <GitCompareIcon className="size-3.5" aria-hidden />
            {triggerLabel}
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 gap-2 p-3">
        <GitRefPicker
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          value={baseRef}
          onValueChange={setBaseRef}
          autoFocus
          quickRefs={['main', 'master', 'HEAD']}
          placeholder={t('reviews.compareBaseRef.placeholder' as DiffReviewKey)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        <GitRefPicker
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          value={headRef}
          onValueChange={setHeadRef}
          quickRefs={['HEAD']}
          placeholder={t('reviews.compareHeadRef.placeholder' as DiffReviewKey)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px]"
            disabled={!baseRef.trim() || !headRef.trim() || pending}
            onClick={submit}
          >
            {pending && <Spinner className="size-3.5" />}
            Open
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
