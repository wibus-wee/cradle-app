import {
  ExternalLinkLine as ExternalLinkIcon,
  GitPullRequestLine as PullRequestIcon,
  Search2Line as SearchIcon,
} from '@mingcute/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

import type { PullRequestViewer } from './api/pull-requests'
import { PullRequestFilterTabsView } from './pull-request-filter-tabs-view'
import type { PullRequestFilter } from './pull-request-list-presenter'
import {
  groupPullRequestsByRecency,
  matchesPullRequestFilter,
  matchesPullRequestSearch,
} from './pull-request-list-presenter'
import { PullRequestListSkeletonView } from './pull-request-list-skeleton-view'
import { PullRequestRecencyGroupView } from './pull-request-recency-group-view'
import type { CradlePullRequest, PullRequestFeedPage } from './use-pull-requests'

export interface PullRequestsPageViewProps {
  entries: CradlePullRequest[]
  viewer: PullRequestViewer | null
  pending: boolean
  authRequired: boolean
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
  authRequired,
  authoredFeed,
  reviewingFeed,
  selectedRef,
  now = Date.now(),
  onPrefetch,
  onSelect,
}: PullRequestsPageViewProps) {
  const { t, i18n } = useTranslation('pull-requests')
  const [filter, setFilter] = useState<PullRequestFilter>('all')
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
        && matchesPullRequestSearch(item, deferredSearch),
    ),
    [deferredSearch, entries, filter],
  )
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

  if (authRequired) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="pull-requests-page">
        <header className="flex shrink-0 items-center border-b border-border/60 px-5 py-4">
          <h1 className="text-lg font-semibold text-foreground">{t('page.title')}</h1>
        </header>
        <div className="min-h-0 flex-1">
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><PullRequestIcon /></EmptyMedia>
              <EmptyTitle>{t('auth.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('auth.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button variant="outline" size="sm" asChild>
                <a href="https://cli.github.com/" target="_blank" rel="noreferrer">
                  <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                  {t('auth.install')}
                </a>
              </Button>
            </EmptyContent>
          </Empty>
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

        <div className="relative shrink-0">
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
            : null}
        </div>
      </header>

      <div className="flex shrink-0 items-center border-b border-border/60 px-2">
        <PullRequestFilterTabsView
          filter={filter}
          pullRequests={entries}
          onChange={setFilter}
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
                </Empty>
              )}
      </div>
    </div>
  )
}
