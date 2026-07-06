import {
  DeleteLine as TrashIcon,
  GridLine as GridIcon,
  MonitorLine as MonitorIcon,
  PlusLine as PlusIcon,
  PuzzledLine as PuzzleIcon,
  Refresh2Line as RefreshIcon,
  SearchLine as SearchIcon,
  ServerLine as ServerIcon,
  WindowsLine as WindowIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deletePluginsSourcesById, getPlugins, getPluginsSources, patchPluginsByRouteSegmentEnabled } from '~/api-gen/sdk.gen'
import type { GetPluginsSourcesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import { AddPluginDialog } from './plugins-add-dialog'
import { SettingsPage } from './settings-container'

type PluginListEntry = {
  identity: string
  routeSegment: string
  name: string
  version: string
  displayName: string
  description: string | null
  iconUrl: string | null
  source: {
    kind: 'workspaceDev' | 'bundledResource' | 'externalLocal'
    packageDir: string
    trusted: boolean
    reason: string | null
  }
  activation: {
    enabled: boolean
    source: 'default' | 'user'
    reason: string | null
    updatedAt: number | null
  }
  active: boolean
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
  warnings: string[]
  capabilities: Array<{ id: string, type: string }>
}

type Filter = 'all' | 'enabled' | 'disabled'
type PluginSourceKind = 'localPath' | 'git' | 'npm'
type PluginSourceEntry = GetPluginsSourcesResponse[number]

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const SOURCE_LABELS: Record<PluginListEntry['source']['kind'], SettingsKey> = {
  workspaceDev: 'plugins.source.workspaceDev' as SettingsKey,
  bundledResource: 'plugins.source.bundled' as SettingsKey,
  externalLocal: 'plugins.source.external' as SettingsKey,
}

const SOURCE_KIND_LABELS: Record<PluginSourceKind, SettingsKey> = {
  localPath: 'plugins.sources.kind.localPath' as SettingsKey,
  git: 'plugins.sources.kind.git' as SettingsKey,
  npm: 'plugins.sources.kind.npm' as SettingsKey,
}

function unsyncDesktopPlugins(source: PluginSourceEntry): void {
  for (const plugin of source.plugins) {
    if (plugin.hasDesktop) {
      void window.cradle?.plugins?.unsyncSource(plugin.identity).catch(() => undefined)
    }
  }
}

export function PluginsSettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const pluginsQuery = useQuery({
    queryKey: ['plugins', 'list'],
    queryFn: async () => {
      const { data, error } = await getPlugins()
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as PluginListEntry[]
    },
  })

  const sourcesQuery = useQuery({
    queryKey: ['plugins', 'sources'],
    queryFn: async () => {
      const { data, error } = await getPluginsSources()
      if (error) {
        throw new Error(String(error))
      }
      return (data ?? []) as GetPluginsSourcesResponse
    },
  })

  const removeSourceMutation = useMutation({
    mutationFn: async (source: PluginSourceEntry) => {
      const { error } = await deletePluginsSourcesById({ path: { id: source.id } })
      if (error) {
        throw new Error(String(error))
      }
      return source
    },
    onSuccess: (source) => {
      unsyncDesktopPlugins(source)
      toastManager.add({ type: 'success', title: t('plugins.sources.toast.removed') })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('plugins.sources.toast.removeFailed') })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'sources'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ routeSegment, enabled }: { routeSegment: string, enabled: boolean }) => {
      const { data, error } = await patchPluginsByRouteSegmentEnabled({
        path: { routeSegment },
        body: { enabled },
      })
      if (error) {
        throw new Error(String(error))
      }
      return data
    },
    onMutate: async ({ routeSegment, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['plugins', 'list'] })
      const previous = queryClient.getQueryData<PluginListEntry[]>(['plugins', 'list'])
      queryClient.setQueryData<PluginListEntry[]>(['plugins', 'list'], current =>
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
      toastManager.add({
        type: 'success',
        title: vars.enabled
          ? t('plugins.toast.enabled')
          : t('plugins.toast.disabled'),
      })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
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
        if (filter === 'enabled' && !plugin.activation.enabled) { return false }
        if (filter === 'disabled' && plugin.activation.enabled) { return false }
        if (!normalizedQuery) { return true }
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

  return (
    <>
    <SettingsPage
      title={t('plugins.page.title')}
      description={t('plugins.page.description')}
      maxWidth="3xl"
      action={
        !loading && plugins.length > 0
          ? (
              <span className="tabular-nums text-[12px] text-muted-foreground">
                {enabledCount}
                {' '}
                /
                {' '}
                {plugins.length}
              </span>
            )
          : undefined
      }
    >
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13px] font-medium text-foreground">{t('plugins.sources.title')}</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t('plugins.sources.description')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              onClick={() => setAddDialogOpen(true)}
              className="h-8 gap-1.5"
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {t('plugins.add.button')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sourcesQuery.refetch()}
              disabled={sourcesQuery.isFetching}
              className="h-8 gap-1.5"
            >
              <RefreshIcon className={cn('size-3.5', sourcesQuery.isFetching && 'animate-spin')} aria-hidden="true" />
              {t('plugins.action.refresh')}
            </Button>
          </div>
        </div>

        {sources.length > 0 && (
          <ul className="flex flex-col gap-2">
            {sources.map(source => (
              <PluginSourceCard
                key={source.id}
                source={source}
                removing={removeSourceMutation.isPending && removeSourceMutation.variables?.id === source.id}
                onRemove={() => removeSourceMutation.mutate(source)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
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
                filter === value
                  ? 'bg-fill text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
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
      </div>

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
                <EmptyState
                  title={t('plugins.empty.title')}
                  description={t('plugins.empty.description')}
                />
              )
            : visiblePlugins.length === 0
              ? (
                  <EmptyState
                    title={t('plugins.empty.noMatches')}
                    description={t('plugins.empty.noMatchesHint')}
                  />
                )
              : (
                  <ul className="flex flex-col gap-2">
                    {visiblePlugins.map(plugin => (
                      <PluginCard
                        key={plugin.routeSegment}
                        plugin={plugin}
                        toggling={toggleMutation.isPending
                          && toggleMutation.variables?.routeSegment === plugin.routeSegment}
                        onToggle={(next) => {
                          void toggleMutation.mutate({
                            routeSegment: plugin.routeSegment,
                            enabled: next,
                          })
                        }}
                      />
                    ))}
                  </ul>
                )}
    </SettingsPage>

      <AddPluginDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </>
  )
}

function PluginSourceCard({
  source,
  removing,
  onRemove,
}: {
  source: PluginSourceEntry
  removing: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation('settings')
  const title = source.label || source.location
  const pluginCount = source.plugins.length

  return (
    <li className="rounded-xl border border-border/60 bg-card px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
            <span className="shrink-0 rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">
              {t(SOURCE_KIND_LABELS[source.kind])}
            </span>
            {source.error && (
              <span className="text-[10.5px] text-destructive">{t('plugins.sources.status.error')}</span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80" title={source.location}>
            {source.location}
          </p>
          {source.resolvedDirectory && (
            <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground/60" title={source.resolvedDirectory}>
              {source.resolvedDirectory}
            </p>
          )}
          {source.error && (
            <p className="mt-1 line-clamp-2 text-[11px] text-destructive/80" title={source.error}>
              {source.error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t('plugins.sources.pluginsCount', { count: pluginCount })}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={removing}
            onClick={onRemove}
            aria-label={t('plugins.sources.removeAria', { name: title })}
            className="size-8"
          >
            <TrashIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </li>
  )
}

function PluginCard({
  plugin,
  toggling,
  onToggle,
}: {
  plugin: PluginListEntry
  toggling: boolean
  onToggle: (next: boolean) => void
}) {
  const { t } = useTranslation('settings')
  const enabled = plugin.activation.enabled

  return (
    <li className={cn('overflow-hidden rounded-xl border border-border/60 bg-card', !enabled && 'opacity-60')}>
      <div className="flex items-start gap-3 px-3.5 py-3">
        <PluginMark plugin={plugin} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">
              {plugin.displayName || plugin.name}
            </span>
            <span className="shrink-0 rounded-md bg-fill px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
              v
{plugin.version}
            </span>
            {plugin.activation.source === 'user' && (
              <span className="shrink-0 text-[10.5px] text-muted-foreground/80">
                {t('plugins.badge.pinned')}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {plugin.description || t('plugins.noDescription')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Switch
            size="sm"
            checked={enabled}
            disabled={toggling}
            onCheckedChange={onToggle}
            aria-label={t('plugins.toggleAria', { name: plugin.displayName })}
          />
          <span className="text-[10.5px] tabular-nums text-muted-foreground/80">
            {t(SOURCE_LABELS[plugin.source.kind])}
          </span>
        </div>
      </div>

      {(plugin.hasServer || plugin.hasWeb || plugin.hasDesktop || plugin.capabilities.length > 0 || plugin.warnings.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3.5 py-2">
          {plugin.hasServer && <LayerChip icon={<ServerIcon className="size-3" />} label="Server" />}
          {plugin.hasWeb && <LayerChip icon={<WindowIcon className="size-3" />} label="Web" />}
          {plugin.hasDesktop && <LayerChip icon={<MonitorIcon className="size-3" />} label="Desktop" />}
          {plugin.capabilities.length > 0 && (
            <LayerChip
              icon={<GridIcon className="size-3" />}
              label={t('plugins.capabilities', { count: plugin.capabilities.length })}
            />
          )}
          {plugin.warnings.length > 0 && (
            <span className="line-clamp-1 text-[11px] text-muted-foreground/80" title={plugin.warnings[0]}>
              ·
{' '}
{plugin.warnings[0]}
            </span>
          )}
          <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground/60" title={plugin.routeSegment}>
            {plugin.routeSegment}
          </span>
        </div>
      )}
    </li>
  )
}

function PluginMark({ plugin }: { plugin: PluginListEntry }) {
  const [failed, setFailed] = useState(false)
  const absoluteIconUrl = useMemo(() => {
    if (!plugin.iconUrl) { return null }
    try {
      return new URL(plugin.iconUrl, getServerUrl()).toString()
    }
 catch {
      return plugin.iconUrl
    }
  }, [plugin.iconUrl])

  if (absoluteIconUrl && !failed) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-card">
        <img
          src={absoluteIconUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }
  const initial = (plugin.displayName || plugin.name).trim().charAt(0).toUpperCase() || '?'
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted text-[13px] font-semibold text-foreground/80 select-none"
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}

function LayerChip({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-fill px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
      {icon}
      {label}
    </span>
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
