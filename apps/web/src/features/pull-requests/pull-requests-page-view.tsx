import {
  CloseLine as CloseIcon,
  GitPullRequestLine as PullRequestIcon,
  Refresh1Line as RefreshIcon,
  Search2Line as SearchIcon,
} from '@mingcute/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'

import type { PullRequestViewer } from './api/pull-requests'
import type { PullRequestErrorKind } from './pull-request-error'
import { PullRequestErrorStateView } from './pull-request-error-state-view'
import { PullRequestFilterTabsView } from './pull-request-filter-tabs-view'
import { PullRequestListFilterMenuView } from './pull-request-list-filter-menu-view'
import type { PullRequestFilter, PullRequestStateFilter } from './pull-request-list-presenter'
import {
  groupPullRequestsByRecency,
  listPullRequestRepositories,
  matchesPullRequestFilter,
  matchesPullRequestRepository,
  matchesPullRequestSearch,
  matchesPullRequestState,
} from './pull-request-list-presenter'
import { PullRequestListSkeletonView } from './pull-request-list-skeleton-view'
import { PullRequestRecencyGroupView } from './pull-request-recency-group-view'
import type { CradlePullRequest, PullRequestFeedPage } from './use-pull-requests'

export interface PullRequestsPageViewProps {
  entries: CradlePullRequest[]
  viewer: PullRequestViewer | null
  pending: boolean
  errorKind: PullRequestErrorKind | null
  retrying?: boolean
  onRetry?: () => void
  refreshing?: boolean
  onRefresh: () => void
  authoredFeed: PullRequestFeedPage
  reviewingFeed: PullRequestFeedPage
  selectedRef?: string
  now?: number
  onPrefetch: (item: CradlePullRequest) => void
  onSelect: (item: CradlePullRequest) => void
}

export function PullRequestsPageView({
  entries,
  viewer,
  pending,
  errorKind,
  retrying = false,
  onRetry,
  refreshing = false,
  onRefresh,
  authoredFeed,
  reviewingFeed,
  selectedRef,
  now = Date.now(),
  onPrefetch,
  onSelect,
}: PullRequestsPageViewProps) {
  const { t, i18n } = useTranslation('pull-requests')
  const [filter, setFilter] = useState<PullRequestFilter>('all')
  const [stateFilter, setStateFilter] = useState<PullRequestStateFilter>('all')
  const [repository, setRepository] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase())
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      if (
        event.key === '/'
        && !typing
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
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
    () => entries.filter(
      item => matchesPullRequestFilter(item, filter)
        && matchesPullRequestState(item, stateFilter)
        && matchesPullRequestRepository(item, repository)
        && matchesPullRequestSearch(item, deferredSearch),
    ),
    [deferredSearch, entries, filter, repository, stateFilter],
  )
  const repositories = useMemo(() => listPullRequestRepositories(entries), [entries])
  const groups = useMemo(
    () => groupPullRequestsByRecency(visiblePullRequests, now),
    [now, visiblePullRequests],
  )
  const activeFeeds = filter === 'authored'
    ? [authoredFeed]
    : filter === 'reviewing'
      ? [reviewingFeed]
      : [authoredFeed, reviewingFeed]
  const hasMorePullRequests = activeFeeds.some(feed => feed.hasNextPage)
  const isFetchingMorePullRequests = activeFeeds.some(feed => feed.isFetchingNextPage)

  const loadMorePullRequests = () => {
    for (const feed of activeFeeds) {
      if (feed.hasNextPage) {
        feed.fetchNextPage()
      }
    }
  }

  if (errorKind) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="pull-requests-page">
        <header className="flex shrink-0 items-center border-b border-border/60 px-5 py-4">
          <h1 className="text-lg font-semibold text-foreground">{t('page.title')}</h1>
        </header>
        <div className="min-h-0 flex-1">
          <PullRequestErrorStateView
            kind={errorKind}
            retrying={retrying}
            onRetry={onRetry}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pull-requests-page">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-semibold text-foreground">{t('page.title')}</h1>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {entries.length}
            </span>
          </div>
          {viewer
            ? (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t('page.description', { login: viewer.login })}
                </p>
              )
            : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onRefresh}
            disabled={refreshing || !viewer}
            aria-label={t('page.refresh')}
            title={t('page.refresh')}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshIcon className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden />
          </Button>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={t('page.searchPlaceholder')}
              className="h-8 w-56 rounded-lg border-border/60 bg-muted/30 pl-8 pr-10 text-[12px] shadow-none"
              aria-label={t('page.searchPlaceholder')}
            />
            {!search
              ? (
                  <kbd
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/60"
                    aria-hidden="true"
                  >
                    ⌘K
                  </kbd>
                )
              : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      setSearch('')
                      searchInputRef.current?.focus()
                    }}
                    aria-label={t('page.clearSearch')}
                    title={t('page.clearSearch')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <CloseIcon className="size-3.5" aria-hidden />
                  </Button>
                )}
          </div>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <PullRequestFilterTabsView
          filter={filter}
          pullRequests={entries}
          onChange={setFilter}
        />
        <PullRequestListFilterMenuView
          stateFilter={stateFilter}
          repository={repository}
          repositories={repositories}
          pullRequests={entries}
          onStateChange={setStateFilter}
          onRepositoryChange={setRepository}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [content-visibility:auto]">
        {pending
          ? <PullRequestListSkeletonView />
          : visiblePullRequests.length > 0
            ? (
                <div className="mx-auto max-w-4xl px-3 pt-3 pb-6">
                  {groups.map(group => (
                    <PullRequestRecencyGroupView
                      key={group.id}
                      group={group}
                      selectedRef={selectedRef}
                      locale={i18n.language}
                      now={now}
                      onPrefetch={onPrefetch}
                      onSelect={onSelect}
                    />
                  ))}
                  {hasMorePullRequests
                    ? (
                        <div className="mt-4 flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={loadMorePullRequests}
                            disabled={isFetchingMorePullRequests}
                            className="text-[12px]"
                          >
                            {isFetchingMorePullRequests
                              ? t('page.loadingMore')
                              : t('page.loadMore')}
                          </Button>
                        </div>
                      )
                    : null}
                </div>
              )
            : (
                <Empty className="h-full border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><PullRequestIcon /></EmptyMedia>
                    <EmptyTitle>
                      {entries.length === 0 ? t('empty.title') : t('empty.filteredTitle')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {entries.length === 0
                        ? t('empty.description')
                        : t('empty.filteredDescription')}
                    </EmptyDescription>
                  </EmptyHeader>
                  {entries.length > 0
                    ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearch('')
                            setFilter('all')
                            setStateFilter('all')
                            setRepository(null)
                          }}
                        >
                          {t('empty.clearFilters')}
                        </Button>
                      )
                    : null}
                </Empty>
              )}
      </div>
    </div>
  )
}
