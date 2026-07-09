/**
 * Marketplace tab (Plan 031).
 *
 * Browseable, searchable catalog of plugins served by `GET /plugins/marketplace`.
 * Search/filter/category are client-side (the catalog is small). Featured entries
 * get a horizontal row when no category filter is active. Each card adapts to its
 * entry: bundled -> Enable (already on disk), installable -> Install (opens the
 * shared InstallWizard in a sheet), already-installed -> "已安装".
 */
import {
  PuzzledLine as PuzzleIcon,
  Refresh2Line as RefreshIcon,
  SearchLine as SearchIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getPlugins, getPluginsMarketplace, getPluginsSources, patchPluginsByRouteSegmentEnabled, postPluginsMarketplaceRefresh } from '~/api-gen/sdk.gen'
import type { GetPluginsMarketplaceResponse, GetPluginsResponse, GetPluginsSourcesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import type { WizardSource } from './install-wizard'
import { InstallWizard } from './install-wizard'

type MarketplaceEntry = GetPluginsMarketplaceResponse['plugins'][number]
type InstalledPlugin = GetPluginsResponse[number]
type PluginSourceEntry = GetPluginsSourcesResponse[number]

const CATEGORIES = ['all', 'automation', 'mcp', 'integration', 'skill', 'dev'] as const
type Category = typeof CATEGORIES[number]

function resolveIconUrl(iconUrl: string | null): string | null {
  if (!iconUrl) {
    return null
  }
  try {
    return new URL(iconUrl, getServerUrl()).toString()
  }
  catch {
    return iconUrl
  }
}

function formatUpdatedAt(fetchedAt: number | null, t: ReturnType<typeof useTranslation<'settings'>>['t']): string | null {
  if (!fetchedAt) {
    return null
  }
  const date = new Date(fetchedAt)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return t('plugins.center.updatedAt', { time })
}

export function MarketplaceTab() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [installEntry, setInstallEntry] = useState<MarketplaceEntry | null>(null)

  const marketplaceQuery = useQuery({
    queryKey: ['plugins', 'marketplace'],
    queryFn: async () => {
      const { data, error } = await getPluginsMarketplace()
      if (error) {
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }
      return data as GetPluginsMarketplaceResponse
    },
  })

  const installedQuery = useQuery({
    queryKey: ['plugins', 'list'],
    queryFn: async () => {
      const { data, error } = await getPlugins()
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as InstalledPlugin[]
    },
  })

  const sourcesQuery = useQuery({
    queryKey: ['plugins', 'sources'],
    queryFn: async () => {
      const { data, error } = await getPluginsSources()
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as PluginSourceEntry[]
    },
  })

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postPluginsMarketplaceRefresh()
      if (error) {
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('plugins.center.refresh') })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'marketplace'] })
    },
  })

  const enableMutation = useMutation({
    mutationFn: async (routeSegment: string) => {
      const { error } = await patchPluginsByRouteSegmentEnabled({ path: { routeSegment }, body: { enabled: true } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      toastManager.add({ type: 'success', title: t('plugins.toast.enabled') })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('plugins.toast.toggleFailed') })
    },
  })

  const entries = marketplaceQuery.data?.plugins ?? []
  const installedPlugins = installedQuery.data ?? []
  const sources = sourcesQuery.data ?? []

  const normalizedQuery = query.trim().toLowerCase()

  const visible = useMemo(() => {
    return entries.filter((entry) => {
      if (category !== 'all' && entry.category !== category) {
        return false
      }
      if (!normalizedQuery) {
        return true
      }
      return (
        entry.displayName.toLowerCase().includes(normalizedQuery)
        || entry.description.toLowerCase().includes(normalizedQuery)
        || entry.tags.some(tag => tag.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [entries, category, normalizedQuery])

  const featured = useMemo(() => {
    if (category !== 'all' || normalizedQuery) {
      return []
    }
    return entries.filter(entry => entry.featured)
  }, [entries, category, normalizedQuery])

  const updatedAt = formatUpdatedAt(marketplaceQuery.data?.fetchedAt ?? null, t)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-1 pb-3">
        <div className="relative min-w-[200px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('plugins.center.search.placeholder')}
            className="h-8 w-full rounded-md border border-border/60 bg-card pl-8 pr-3 text-[12.5px] text-foreground outline-none transition focus:border-foreground/30 placeholder:text-muted-foreground/70"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="h-8 gap-1.5"
        >
          <RefreshIcon className={cn('size-3.5', refreshMutation.isPending && 'animate-spin')} aria-hidden="true" />
          {t('plugins.center.refresh')}
        </Button>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-1.5 px-1 pb-3">
        {CATEGORIES.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11.5px] transition',
              category === value
                ? 'border-foreground/30 bg-fill text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`plugins.center.category.${value}`)}
          </button>
        ))}
        {marketplaceQuery.data?.stale && (
          <span className="ml-auto text-[10.5px] text-amber-600 dark:text-amber-300">{t('plugins.center.stale')}</span>
        )}
        {updatedAt && !marketplaceQuery.data?.stale && (
          <span className="ml-auto text-[10.5px] text-muted-foreground/70">{updatedAt}</span>
        )}
      </div>

      {/* Scroll area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {marketplaceQuery.isLoading
          ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-muted-foreground">
                <Spinner className="size-3.5" />
              </div>
            )
          : marketplaceQuery.isError
            ? (
                <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
                  {t('plugins.error')}
                </div>
              )
            : entries.length === 0
              ? (
                  <EmptyState title={t('plugins.center.empty')} />
                )
              : visible.length === 0
                ? (
                    <EmptyState title={t('plugins.marketplace.noMatches')} />
                  )
                : (
                    <>
                      {featured.length > 0 && (
                        <section className="mb-4">
                          <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                            <SparklesIcon className="size-3.5" aria-hidden="true" />
                            {t('plugins.marketplace.featured')}
                          </h3>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {featured.map(entry => (
                              <MarketplaceCard
                                key={entry.id}
                                entry={entry}
                                featured
                                installedPlugins={installedPlugins}
                                sources={sources}
                                enabling={enableMutation.isPending && enableMutation.variables === findRouteSegment(installedPlugins, entry)}
                                onEnable={routeSegment => enableMutation.mutate(routeSegment)}
                                onInstall={() => setInstallEntry(entry)}
                              />
                            ))}
                          </div>
                        </section>
                      )}

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {visible.map(entry => (
                          <MarketplaceCard
                            key={entry.id}
                            entry={entry}
                            installedPlugins={installedPlugins}
                            sources={sources}
                            enabling={enableMutation.isPending && enableMutation.variables === findRouteSegment(installedPlugins, entry)}
                            onEnable={routeSegment => enableMutation.mutate(routeSegment)}
                            onInstall={() => setInstallEntry(entry)}
                          />
                        ))}
                      </div>
                    </>
                  )}
      </div>

      <Sheet open={installEntry !== null} onOpenChange={open => !open && setInstallEntry(null)}>
        <SheetContent side="right" className="w-3/4 gap-0 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{installEntry?.displayName ?? ''}</SheetTitle>
            <SheetDescription>{installEntry?.description ?? ''}</SheetDescription>
          </SheetHeader>
          {installEntry?.source && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <InstallWizard
                initialSource={entryToWizardSource(installEntry)}
                sourceLabel={installEntry.displayName}
                mode="source"
                onDismiss={() => setInstallEntry(null)}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function findRouteSegment(installedPlugins: InstalledPlugin[], entry: MarketplaceEntry): string | null {
  if (!entry.bundled) {
    return null
  }
  const match = installedPlugins.find(plugin => plugin.displayName.toLowerCase() === entry.displayName.toLowerCase())
  return match?.routeSegment ?? null
}

function entryToWizardSource(entry: MarketplaceEntry): WizardSource | undefined {
  if (!entry.source) {
    return undefined
  }
  return {
    kind: entry.source.kind,
    location: entry.source.location,
    ref: entry.source.ref,
    subPath: entry.source.subPath,
  }
}

function isInstallableInstalled(entry: MarketplaceEntry, sources: PluginSourceEntry[]): boolean {
  if (!entry.source) {
    return false
  }
  return sources.some(source =>
    source.location === entry.source!.location
    && (source.subPath ?? null) === (entry.source!.subPath ?? null))
}

interface MarketplaceCardProps {
  entry: MarketplaceEntry
  featured?: boolean
  installedPlugins: InstalledPlugin[]
  sources: PluginSourceEntry[]
  enabling: boolean
  onEnable: (routeSegment: string) => void
  onInstall: () => void
}

function MarketplaceCard({ entry, featured, installedPlugins, sources, enabling, onEnable, onInstall }: MarketplaceCardProps) {
  const { t } = useTranslation('settings')
  const iconUrl = useMemo(() => resolveIconUrl(entry.icon), [entry.icon])

  const bundledMatch = entry.bundled ? installedPlugins.find(plugin => plugin.displayName.toLowerCase() === entry.displayName.toLowerCase()) : undefined
  const bundledEnabled = bundledMatch?.activation.enabled ?? false
  const installableInstalled = isInstallableInstalled(entry, sources)

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-3', featured && 'min-w-[240px]')}>
      <div className="flex items-start gap-2.5">
        <PluginAvatar iconUrl={iconUrl} name={entry.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{entry.displayName}</span>
            {entry.bundled && (
              <span className="shrink-0 rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">{t('plugins.marketplace.bundled')}</span>
            )}
            {entry.featured && !featured && (
              <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-px text-[10.5px] text-amber-600 dark:text-amber-300">{t('plugins.marketplace.featured')}</span>
            )}
          </div>
          {entry.author && (
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
              {t('plugins.marketplace.author')}
:
{entry.author.name}
            </p>
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{entry.description}</p>

      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.slice(0, 3).map(tag => (
            <span key={tag} className="rounded-md bg-fill px-1.5 py-px text-[10px] text-muted-foreground">{tag}</span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {entry.bundled
          ? bundledMatch
            ? bundledEnabled
              ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    {t('plugins.marketplace.installed')}
                  </span>
                )
              : (
                  <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={enabling} onClick={() => bundledMatch && onEnable(bundledMatch.routeSegment)}>
                    {enabling ? <Spinner className="size-3" /> : null}
                    {t('plugins.marketplace.enable')}
                  </Button>
                )
            : (
                <span className="text-[10.5px] text-muted-foreground/70">{t('plugins.marketplace.installed')}</span>
              )
          : installableInstalled
            ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  {t('plugins.marketplace.installed')}
                </span>
              )
            : (
                <Button size="sm" className="h-7 gap-1.5" onClick={onInstall}>
                  {t('plugins.marketplace.install')}
                </Button>
              )}
        {entry.homepage && (
          <a
            href={entry.homepage}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[10.5px] text-muted-foreground/70 transition hover:text-foreground"
          >
            ↗
          </a>
        )}
      </div>
    </div>
  )
}

function PluginAvatar({ iconUrl, name }: { iconUrl: string | null, name: string }) {
  const [failed, setFailed] = useState(false)
  if (iconUrl && !failed) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-card">
        <img src={iconUrl} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      </div>
    )
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted text-[14px] font-semibold text-foreground/80 select-none" aria-hidden="true">
      {initial}
    </div>
  )
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
      <PuzzleIcon className="size-5 text-muted-foreground/60" aria-hidden="true" />
      <p className="text-[12px] text-muted-foreground">{title}</p>
    </div>
  )
}
