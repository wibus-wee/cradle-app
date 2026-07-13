import {
  GitBranchLine as GitBranchIcon,
  GitPullRequestLine as PullRequestIcon,
  Search2Line as SearchIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/cn'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { pullRequestQueryOptions } from './api/pull-requests'
import { CHECKS_DOT_CLASS, STATUS_ICON, STATUS_ICON_CLASS, statusKind } from './status-meta'
import type { CradlePullRequest, PullRequestRole } from './use-pull-requests'
import { useCradlePullRequests } from './use-pull-requests'

type PullRequestFilter = 'all' | PullRequestRole
type RecencyGroupId = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

const FILTERS: PullRequestFilter[] = ['all', 'reviewing', 'authored']
const RECENCY_GROUP_ORDER: RecencyGroupId[] = ['today', 'yesterday', 'thisWeek', 'earlier']
const PULL_REQUEST_LAYOUT_SLOTS = { hasBrowserPanel: true } as const

function matchesFilter(item: CradlePullRequest, filter: PullRequestFilter): boolean {
  return filter === 'all' || item.role === filter
}

function matchesSearch(item: CradlePullRequest, query: string): boolean {
  if (!query) {
    return true
  }
  const pullRequest = item.pullRequest
  return [
    pullRequest.title,
    pullRequest.owner,
    pullRequest.repo,
    pullRequest.headRef,
    pullRequest.baseRef,
    String(pullRequest.number),
  ].some(value => value.toLocaleLowerCase().includes(query))
}

function formatDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp * 1000).getFullYear() === new Date().getFullYear()
      ? undefined
      : 'numeric',
  }).format(timestamp * 1000)
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Buckets a timestamp against "now" by calendar day, not raw elapsed hours,
 *  so 11pm yesterday still reads as "Yesterday" this morning.
 */
function recencyGroupId(updatedAtSeconds: number, nowMs: number): RecencyGroupId {
  const diffDays = Math.floor((startOfDay(nowMs) - startOfDay(updatedAtSeconds * 1000)) / 86_400_000)
  if (diffDays <= 0) {
    return 'today'
  }
  if (diffDays === 1) {
    return 'yesterday'
  }
  if (diffDays <= 7) {
    return 'thisWeek'
  }
  return 'earlier'
}

function groupByRecency(items: CradlePullRequest[]): Array<{ id: RecencyGroupId, items: CradlePullRequest[] }> {
  const now = Date.now()
  const sorted = [...items].sort((a, b) => b.pullRequest.updatedAt - a.pullRequest.updatedAt)
  const buckets = new Map<RecencyGroupId, CradlePullRequest[]>()
  for (const item of sorted) {
    const id = recencyGroupId(item.pullRequest.updatedAt, now)
    const bucket = buckets.get(id)
    if (bucket) {
      bucket.push(item)
    }
    else {
      buckets.set(id, [item])
    }
  }
  return RECENCY_GROUP_ORDER
    .map(id => ({ id, items: buckets.get(id) ?? [] }))
    .filter(group => group.items.length > 0)
}

export function PullRequestsPage({
  selectedRef,
  onSelectedRefChange,
}: {
  selectedRef?: string
  onSelectedRefChange: (ref?: string) => void
}) {
  const { t, i18n } = useTranslation('pull-requests')
  const queryClient = useQueryClient()
  const { entries, viewer, isPending, error, authored, reviewing } = useCradlePullRequests()
  const openPullRequestTab = useBrowserPanelStore(state => state.openPullRequestTab)
  const [filter, setFilter] = useState<PullRequestFilter>('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase())
  const searchInputRef = useRef<HTMLInputElement>(null)

  useRegisterLayoutSlots('pull-requests', PULL_REQUEST_LAYOUT_SLOTS)

  // Linear-style focus: ⌘K / Ctrl+K or "/" focuses the filter; Esc clears - same
  // convention as the Diffs/Reviews list (reviews-list-page.tsx).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
      if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (search) {
          setSearch('')
        }
        else {
          searchInputRef.current?.blur()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [search])

  const visiblePullRequests = useMemo(
    () => entries.filter(item => matchesFilter(item, filter) && matchesSearch(item, deferredSearch)),
    [deferredSearch, filter, entries],
  )
  const groups = useMemo(() => groupByRecency(visiblePullRequests), [visiblePullRequests])

  // Both role feeds are independently cursor-paginated (see use-pull-requests.ts) -
  // "Load more" advances whichever feed(s) the active filter draws from, so a
  // viewer with a long history can page through all of it instead of a silent cap.
  const activeFeeds = filter === 'authored' ? [authored] : filter === 'reviewing' ? [reviewing] : [authored, reviewing]
  const hasMorePullRequests = activeFeeds.some(feed => feed.hasNextPage)
  const isFetchingMorePullRequests = activeFeeds.some(feed => feed.isFetchingNextPage)
  const loadMorePullRequests = () => {
    for (const feed of activeFeeds) {
      if (feed.hasNextPage) {
        feed.fetchNextPage()
      }
    }
  }

  if (error) {
    throw error
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pull-requests-page">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{t('page.title')}</h1>
            <span className="text-[12px] tabular-nums text-muted-foreground">{entries.length}</span>
          </div>
          {viewer && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t('page.description', { login: viewer.login })}
            </p>
          )}
        </div>

        <div className="relative shrink-0">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('page.searchPlaceholder')}
            className="h-8 w-56 rounded-lg border-border/60 bg-muted/30 pl-8 pr-10 text-[12px] shadow-none"
            aria-label={t('page.searchPlaceholder')}
          />
          {!search && (
            <kbd
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/60"
              aria-hidden="true"
            >
              ⌘K
            </kbd>
          )}
        </div>
      </header>

      <div className="flex shrink-0 items-center border-b border-border/60 px-2">
        <FilterTabs filter={filter} onChange={setFilter} pullRequests={entries} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [content-visibility:auto]">
        {isPending
          ? <PullRequestListSkeleton />
          : visiblePullRequests.length > 0
            ? (
                <div className="mx-auto max-w-4xl px-3 pt-3 pb-6">
                  {groups.map(group => (
                    <RecencyGroupSection
                      key={group.id}
                      groupId={group.id}
                      items={group.items}
                      selectedRef={selectedRef}
                      locale={i18n.language}
                      onPrefetch={item => void queryClient.prefetchQuery(pullRequestQueryOptions.detail({
                        path: { owner: item.pullRequest.owner, repo: item.pullRequest.repo, number: String(item.pullRequest.number) },
                      }))}
                      onSelect={(item) => {
                        openPullRequestTab({
                          owner: item.pullRequest.owner,
                          repo: item.pullRequest.repo,
                          number: item.pullRequest.number,
                          workId: item.workId,
                          sessionId: item.primarySessionId,
                          title: item.pullRequest.title,
                          ownerId: 'pull-requests',
                        })
                        onSelectedRefChange(item.id)
                      }}
                    />
                  ))}
                  {hasMorePullRequests && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={loadMorePullRequests}
                        disabled={isFetchingMorePullRequests}
                        className="text-[12px]"
                      >
                        {isFetchingMorePullRequests ? t('page.loadingMore') : t('page.loadMore')}
                      </Button>
                    </div>
                  )}
                </div>
              )
            : (
                <Empty className="h-full border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><PullRequestIcon /></EmptyMedia>
                    <EmptyTitle>{entries.length === 0 ? t('empty.title') : t('empty.filteredTitle')}</EmptyTitle>
                    <EmptyDescription>
                      {entries.length === 0 ? t('empty.description') : t('empty.filteredDescription')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
      </div>
    </div>
  )
}

/**
 * Underline filter tabs - same visual idiom as the Diffs/Reviews list
 *  (`TextTabs` in reviews-list-page.tsx), kept as a plain `role="group"` of
 *  buttons rather than the Radix Tabs primitive: these filter one list in
 *  place, they don't switch between separate tabpanels. Filters are by the
 *  viewer's *role* on the PR (authored vs requested reviewer), not by PR
 *  lifecycle state - lifecycle state is conveyed per-row by the status icon.
 */
function FilterTabs({
  filter,
  onChange,
  pullRequests,
}: {
  filter: PullRequestFilter
  onChange: (filter: PullRequestFilter) => void
  pullRequests: CradlePullRequest[]
}) {
  const { t } = useTranslation('pull-requests')
  const countFor = (value: PullRequestFilter) => pullRequests.filter(item => matchesFilter(item, value)).length

  return (
    <div className="flex items-end gap-4" role="group" aria-label={t('filter.label')}>
      {FILTERS.map((value) => {
        const active = filter === value
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(value)}
            aria-pressed={active}
            className={cn(
              'relative h-9 gap-1.5 rounded-none px-0 text-[13px] hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`filter.${value}`)}
            <span className="tabular-nums text-muted-foreground/70">{countFor(value)}</span>
            {active && (
              <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[1.5px] bg-foreground" />
            )}
          </Button>
        )
      })}
    </div>
  )
}

function RecencyGroupSection({
  groupId,
  items,
  selectedRef,
  locale,
  onPrefetch,
  onSelect,
}: {
  groupId: RecencyGroupId
  items: CradlePullRequest[]
  selectedRef?: string
  locale: string
  onPrefetch: (item: CradlePullRequest) => void
  onSelect: (item: CradlePullRequest) => void
}) {
  const { t } = useTranslation('pull-requests')

  return (
    <section className="mt-5 first:mt-0">
      <div className="flex h-7 items-center px-3">
        <span className="text-[11px] font-medium text-muted-foreground">{t(`group.${groupId}`)}</span>
      </div>
      <ul role="list" className="flex flex-col gap-0.5">
        {items.map(item => (
          <li key={item.id}>
            <PullRequestRow
              item={item}
              active={item.id === selectedRef}
              locale={locale}
              onPrefetch={() => onPrefetch(item)}
              onSelect={() => onSelect(item)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function PullRequestRow({
  item,
  active,
  locale,
  onPrefetch,
  onSelect,
}: {
  item: CradlePullRequest
  active: boolean
  locale: string
  onPrefetch: () => void
  onSelect: () => void
}) {
  const { t } = useTranslation('pull-requests')
  const pullRequest = item.pullRequest
  const status = statusKind(pullRequest)
  const StatusIcon = STATUS_ICON[status]
  const checksDotClass = CHECKS_DOT_CLASS[pullRequest.checksState]
  const hasDiffStat = pullRequest.additions !== undefined && pullRequest.deletions !== undefined

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-current={active ? 'true' : undefined}
      data-testid={`pull-request-row-${item.id}`}
      className={cn(
        'group h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal transition-colors',
        active ? 'bg-muted hover:bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <span className={cn('relative shrink-0', STATUS_ICON_CLASS[status])}>
        <StatusIcon className="size-4" aria-hidden="true" />
        {checksDotClass && (
          <span
            className={cn('absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full outline outline-2 outline-background', checksDotClass)}
            aria-hidden="true"
          />
        )}
        <span className="sr-only">{t(`status.${status}`)}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90 group-hover:text-foreground">
            {pullRequest.title}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
            {formatDate(pullRequest.updatedAt, locale)}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-mono font-medium text-foreground/55">
            {pullRequest.owner}
            /
            {pullRequest.repo}
            {' #'}
            {pullRequest.number}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex min-w-0 items-center gap-1 truncate font-mono">
            <GitBranchIcon className="size-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{pullRequest.headRef}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2.5">
            {pullRequest.author && (
              <span className="flex items-center gap-1">
                <img
                  src={pullRequest.author.avatarUrl}
                  alt=""
                  className="size-3.5 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                />
                <span className="truncate text-muted-foreground/80">{pullRequest.author.login}</span>
              </span>
            )}
            {hasDiffStat && (
              <span className="flex items-center gap-1 font-mono tabular-nums">
                <span className="text-success">
                  +
                  {pullRequest.additions}
                </span>
                <span className="text-destructive">
                  −
                  {pullRequest.deletions}
                </span>
              </span>
            )}
          </span>
        </span>
      </span>
    </Button>
  )
}

function PullRequestListSkeleton() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-0.5 px-3 pt-3 pb-6">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-4 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
