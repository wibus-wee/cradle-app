/**
 * Installed tab (Plan 031, migrated from the old settings plugins list).
 *
 * Cleaned PluginCard: icon, name, version, description, provenance line, enable
 * Switch, and Uninstall for external-local plugins. Enabling an untrusted
 * external goes through TrustConsentDialog; uninstalling a source that fans out
 * to >1 plugin asks for confirmation. No footer telemetry strip.
 */
import { DeleteLine as TrashIcon, PuzzledLine as PuzzleIcon, Refresh2Line as RefreshIcon, SearchLine as SearchIcon } from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deletePluginsSourcesById, getPlugins, getPluginsSources, patchPluginsByRouteSegmentEnabled } from '~/api-gen/sdk.gen'
import type { GetPluginsResponse, GetPluginsSourcesResponse } from '~/api-gen/types.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import { TrustConsentDialog } from './plugins-trust-consent-dialog'

type InstalledPlugin = GetPluginsResponse[number]
type PluginSourceEntry = GetPluginsSourcesResponse[number]
type Filter = 'all' | 'enabled' | 'disabled'

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

function findOwningSource(plugin: InstalledPlugin, sources: PluginSourceEntry[]): PluginSourceEntry | undefined {
  return sources.find(source => source.plugins.some(p => p.identity === plugin.identity))
}

function provenanceLabel(plugin: InstalledPlugin, sources: PluginSourceEntry[], t: ReturnType<typeof useTranslation<'settings'>>['t']): string {
  if (plugin.source.kind === 'bundledResource') {
    return t('plugins.provenance.bundled')
  }
  if (plugin.source.kind === 'workspaceDev') {
    return t('plugins.provenance.workspaceDev')
  }
  const owner = findOwningSource(plugin, sources)
  if (owner?.kind === 'git') {
    return t('plugins.provenance.github', { location: owner.location })
  }
  if (owner?.kind === 'npm') {
    return t('plugins.provenance.npm', { location: owner.location })
  }
  return t('plugins.provenance.local')
}

function unsyncDesktopPlugins(plugins: Array<{ identity: string, hasDesktop: boolean }>): void {
  for (const plugin of plugins) {
    if (plugin.hasDesktop) {
      void window.cradle?.plugins?.unsyncSource(plugin.identity).catch(() => undefined)
    }
  }
}

export function InstalledTab() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [trustTarget, setTrustTarget] = useState<string | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPlugin | null>(null)

  const pluginsQuery = useQuery({
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

  const toggleMutation = useMutation({
    mutationFn: async ({ routeSegment, enabled }: { routeSegment: string, enabled: boolean }) => {
      const { data, error } = await patchPluginsByRouteSegmentEnabled({ path: { routeSegment }, body: { enabled } })
      if (error) {
        throw new Error(String(error))
      }
      return data
    },
    onMutate: async ({ routeSegment, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['plugins', 'list'] })
      const previous = queryClient.getQueryData<InstalledPlugin[]>(['plugins', 'list'])
      queryClient.setQueryData<InstalledPlugin[]>(['plugins', 'list'], current =>
        (current ?? []).map(plugin =>
          plugin.routeSegment === routeSegment
            ? { ...plugin, activation: { ...plugin.activation, enabled, source: 'user', updatedAt: Date.now() } }
            : plugin))
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['plugins', 'list'], ctx.previous)
      }
      toastManager.add({ type: 'error', title: t('plugins.toast.toggleFailed') })
    },
    onSuccess: (_data, vars) => {
      toastManager.add({ type: 'success', title: vars.enabled ? t('plugins.toast.enabled') : t('plugins.toast.disabled') })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'sources'] })
    },
  })

  const uninstallMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await deletePluginsSourcesById({ path: { id: sourceId } })
      if (error) {
        throw new Error(String(error))
      }
    },
    onSuccess: () => {
      const target = uninstallTarget
      if (target) {
        const owner = findOwningSource(target, sourcesQuery.data ?? [])
        if (owner) {
          unsyncDesktopPlugins(owner.plugins)
        }
      }
      toastManager.add({ type: 'success', title: t('plugins.sources.toast.removed') })
      setUninstallTarget(null)
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('plugins.sources.toast.removeFailed') })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'sources'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'marketplace'] })
    },
  })

  const plugins = useMemo(() => pluginsQuery.data ?? [], [pluginsQuery.data])
  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data])
  const loading = pluginsQuery.isLoading

  const enabledCount = useMemo(() => plugins.filter(p => p.activation.enabled).length, [plugins])

  const visiblePlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return plugins
      .filter((plugin) => {
        if (filter === 'enabled' && !plugin.activation.enabled) {
          return false
        }
        if (filter === 'disabled' && plugin.activation.enabled) {
          return false
        }
        if (!normalizedQuery) {
          return true
        }
        return (
          plugin.displayName.toLowerCase().includes(normalizedQuery)
          || plugin.name.toLowerCase().includes(normalizedQuery)
          || (plugin.description ?? '').toLowerCase().includes(normalizedQuery)
        )
      })
      .sort((a, b) => {
        if (a.activation.enabled !== b.activation.enabled) {
          return a.activation.enabled ? -1 : 1
        }
        return a.displayName.localeCompare(b.displayName)
      })
  }, [plugins, filter, query])

  const handleToggle = (plugin: InstalledPlugin, next: boolean) => {
    const untrustedExternal = plugin.source.kind === 'externalLocal' && !plugin.source.trusted
    if (next && untrustedExternal) {
      setTrustTarget(plugin.routeSegment)
      return
    }
    toggleMutation.mutate({ routeSegment: plugin.routeSegment, enabled: next })
  }

  const uninstallSource = uninstallTarget ? findOwningSource(uninstallTarget, sources) : undefined
  const uninstallCount = uninstallSource?.plugins.length ?? 1

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-1 pb-3">
        <div className="relative min-w-[200px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('plugins.search.placeholder')}
            className="h-8 w-full rounded-md border border-border/60 bg-card pl-8 pr-3 text-[12.5px] text-foreground outline-none transition focus:border-foreground/30 placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center gap-px rounded-md border border-border/60 bg-card p-0.5">
          {(['all', 'enabled', 'disabled'] as const).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[11.5px] transition',
                filter === value ? 'bg-fill text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`plugins.filter.${value}`)}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void pluginsQuery.refetch()}
          disabled={loading}
          aria-label={t('plugins.action.refresh')}
          className="h-8 gap-1.5"
        >
          <RefreshIcon className={cn('size-3.5', pluginsQuery.isFetching && 'animate-spin')} aria-hidden="true" />
          {t('plugins.action.refresh')}
        </Button>
        {!loading && plugins.length > 0 && (
          <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">
            {enabledCount}
            {' / '}
            {plugins.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {loading
          ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 py-10 text-[12px] text-muted-foreground">
                <Spinner className="size-3.5" />
              </div>
            )
          : pluginsQuery.isError
            ? (
                <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
                  {t('plugins.error')}
                </div>
              )
            : plugins.length === 0
              ? (
                  <EmptyState title={t('plugins.empty.title')} description={t('plugins.empty.description')} />
                )
              : visiblePlugins.length === 0
                ? (
                    <EmptyState title={t('plugins.empty.noMatches')} description={t('plugins.empty.noMatchesHint')} />
                  )
                : (
                    <ul className="flex flex-col gap-2">
                      {visiblePlugins.map(plugin => (
                        <InstalledCard
                          key={plugin.routeSegment}
                          plugin={plugin}
                          sources={sources}
                          toggling={toggleMutation.isPending && toggleMutation.variables?.routeSegment === plugin.routeSegment}
                          onToggle={next => handleToggle(plugin, next)}
                          onUninstall={() => setUninstallTarget(plugin)}
                        />
                      ))}
                    </ul>
                  )}
      </div>

      <TrustConsentDialog
        routeSegment={trustTarget}
        onConfirm={() => trustTarget && toggleMutation.mutate({ routeSegment: trustTarget, enabled: true })}
        onCancel={() => setTrustTarget(null)}
        confirmPending={toggleMutation.isPending}
      />

      <AlertDialog open={uninstallTarget !== null} onOpenChange={open => !open && setUninstallTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('plugins.uninstallConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('plugins.uninstallConfirmBody', {
                count: uninstallCount,
                source: uninstallSource?.label || uninstallSource?.location || '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('plugins.add.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (uninstallSource) {
                  uninstallMutation.mutate(uninstallSource.id)
                }
              }}
              disabled={uninstallMutation.isPending}
            >
              {uninstallMutation.isPending ? <Spinner className="size-3.5" /> : t('plugins.uninstall')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface InstalledCardProps {
  plugin: InstalledPlugin
  sources: PluginSourceEntry[]
  toggling: boolean
  onToggle: (next: boolean) => void
  onUninstall: () => void
}

function InstalledCard({ plugin, sources, toggling, onToggle, onUninstall }: InstalledCardProps) {
  const { t } = useTranslation('settings')
  const enabled = plugin.activation.enabled
  const canUninstall = plugin.source.kind === 'externalLocal'
  const provenance = provenanceLabel(plugin, sources, t)
  const iconUrl = useMemo(() => resolveIconUrl(plugin.iconUrl), [plugin.iconUrl])

  return (
    <li className={cn('overflow-hidden rounded-xl border border-border/60 bg-card', !enabled && 'opacity-60')}>
      <div className="flex items-start gap-3 px-3.5 py-3">
        <PluginAvatar iconUrl={iconUrl} name={plugin.displayName || plugin.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{plugin.displayName || plugin.name}</span>
            <span className="shrink-0 rounded-md bg-fill px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
v
{plugin.version}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {plugin.description || t('plugins.noDescription')}
          </p>
          <p className="mt-1 text-[10.5px] text-muted-foreground/70">{provenance}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Switch
            size="sm"
            checked={enabled}
            disabled={toggling}
            onCheckedChange={onToggle}
            aria-label={t('plugins.toggleAria', { name: plugin.displayName })}
          />
          {canUninstall && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onUninstall}
              aria-label={t('plugins.uninstall')}
              className="text-muted-foreground hover:text-destructive"
            >
              <TrashIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

function PluginAvatar({ iconUrl, name }: { iconUrl: string | null, name: string }) {
  const [failed, setFailed] = useState(false)
  if (iconUrl && !failed) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-card">
        <img src={iconUrl} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      </div>
    )
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted text-[13px] font-semibold text-foreground/80 select-none" aria-hidden="true">
      {initial}
    </div>
  )
}

function EmptyState({ title, description }: { title: string, description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
      <PuzzleIcon className="size-5 text-muted-foreground/60" aria-hidden="true" />
      <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
      <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}
