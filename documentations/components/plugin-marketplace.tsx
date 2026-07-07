'use client'

import {
  CheckLine as Check,
  CopyLine as Copy,
  ExternalLinkLine as ExternalLink,
  FilterLine as Filter,
  LayersLine as Layers,
  PackageLine as Package,
  PluginLine as Plug,
  SafeShieldLine as ShieldCheck,
  SearchLine as Search,
  SparklesLine as Sparkles,
} from '@mingcute/react'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/cn'
import type { PluginMarketplaceCategory, PluginMarketplaceEntry, PluginMarketplaceLayer } from '@/lib/plugin-marketplace'
import {
  createPluginInstallUrl,
  pluginMarketplaceEntries,
} from '@/lib/plugin-marketplace'

type CategoryFilter = 'all' | PluginMarketplaceCategory

const categoryFilters = [
  { id: 'all', label: 'All' },
  { id: 'automation', label: 'Automation' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'provider', label: 'Provider' },
] satisfies Array<{ id: CategoryFilter, label: string }>

const layerLabels = {
  server: 'Server',
  web: 'Web',
  desktop: 'Desktop',
  mcp: 'MCP',
  skill: 'Skill',
} satisfies Record<PluginMarketplaceLayer, string>

const statusLabels = {
  bundled: 'Bundled',
  beta: 'Beta',
} satisfies Record<PluginMarketplaceEntry['status'], string>

const statusClasses = {
  bundled:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  beta: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
} satisfies Record<PluginMarketplaceEntry['status'], string>

const categorySummary = {
  all: 'Every plugin currently listed in the Cradle Marketplace.',
  automation: 'Plugins that let agents operate external or desktop surfaces.',
  diagnostics: 'Plugins that inspect host, runtime, or operational state.',
  provider: 'Plugins that project model or provider metadata into Cradle.',
  workspace: 'Plugins that extend local workspace workflows.',
} satisfies Record<CategoryFilter, string>

function matchesSearch(plugin: PluginMarketplaceEntry, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) { return true }

  const searchableText = [
    plugin.displayName,
    plugin.packageName,
    plugin.summary,
    plugin.description,
    plugin.owner,
    plugin.namespace,
    plugin.category,
    ...plugin.layers,
    ...plugin.capabilities,
  ]
    .join(' ')
    .toLowerCase()

  return searchableText.includes(normalizedQuery)
}

function MarketplaceHeader({
  query,
  category,
  onQueryChange,
  onCategoryChange,
}: {
  query: string
  category: CategoryFilter
  onQueryChange: (value: string) => void
  onCategoryChange: (value: CategoryFilter) => void
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm">
      <div className="grid gap-5 border-b border-fd-border p-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="flex min-w-0 gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-fd-primary text-fd-primary-foreground">
            <Plug className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-semibold leading-7 text-fd-foreground">
              Cradle Plugin Marketplace
            </h2>
            <p className="m-0 mt-1 text-sm leading-6 text-fd-muted-foreground">
              Browse first-party plugins, inspect their runtime layers, and use stable install
              links through the Cradle desktop protocol handler.
            </p>
          </div>
        </div>
        <div className="rounded-lg bg-fd-muted p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-fd-foreground">
            <ShieldCheck className="size-4 !text-emerald-600 dark:!text-emerald-300" aria-hidden="true" />
            Trust boundary
          </div>
          <p className="m-0 mt-2 text-sm leading-6 text-fd-muted-foreground">
            Marketplace links identify a plugin package. The desktop installer still owns consent,
            source verification, filesystem writes, and activation.
          </p>
        </div>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <label className="relative block min-w-0">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 !text-fd-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Search plugins</span>
          <input
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search plugins, layers, capabilities..."
            className="h-11 w-full rounded-md border border-fd-border bg-fd-background pl-10 pr-3 text-sm text-fd-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-fd-muted-foreground focus:border-fd-primary focus:ring-2 focus:ring-fd-primary/20"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {categoryFilters.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onCategoryChange(item.id)}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.96]',
                category === item.id
                  ? 'bg-fd-primary text-fd-primary-foreground'
                  : 'bg-fd-muted text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground',
              )}
            >
              <Filter className="size-3.5" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-fd-border px-5 py-3 text-sm leading-6 text-fd-muted-foreground">
        {categorySummary[category]}
      </div>
    </section>
  )
}

function LayerBadges({ layers }: { layers: PluginMarketplaceLayer[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {layers.map(layer => (
        <span
          key={layer}
          className="inline-flex min-h-7 items-center rounded-md bg-fd-muted px-2 text-xs font-medium text-fd-muted-foreground"
        >
          {layerLabels[layer]}
        </span>
      ))}
    </div>
  )
}

function PluginCard({ plugin }: { plugin: PluginMarketplaceEntry }) {
  const installUrl = createPluginInstallUrl(plugin)
  const [copied, setCopied] = useState(false)

  async function copyInstallUrl() {
    await navigator.clipboard.writeText(installUrl)
    setCopied(true)
    window.setTimeout(setCopied, 1600, false)
  }

  return (
    <article className="flex h-full flex-col gap-4 rounded-lg border border-fd-border bg-fd-card p-4 shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-fd-muted text-fd-foreground">
            <Package className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-base font-semibold leading-7 text-fd-foreground">
                {plugin.displayName}
              </h3>
              <span
                className={cn(
                  'inline-flex min-h-7 items-center rounded-md border px-2 text-xs font-medium',
                  statusClasses[plugin.status],
                )}
              >
                {statusLabels[plugin.status]}
              </span>
            </div>
            <p className="m-0 font-mono text-xs leading-5 text-fd-muted-foreground">
              {plugin.packageName}
            </p>
          </div>
        </div>

        <p className="m-0 mt-4 text-sm font-medium leading-6 text-fd-foreground">
          {plugin.summary}
        </p>
        <p className="m-0 mt-2 text-sm leading-6 text-fd-muted-foreground">
          {plugin.description}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
              <Layers className="size-3.5" aria-hidden="true" />
              Layers
            </div>
            <LayerBadges layers={plugin.layers} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Capabilities
            </div>
            <ul className="m-0 grid list-none gap-1 p-0">
              {plugin.capabilities.map(capability => (
                <li key={capability} className="flex min-w-0 items-start gap-2 text-sm leading-6 text-fd-muted-foreground">
                  <Check className="mt-1 size-3.5 shrink-0 !text-emerald-600 dark:!text-emerald-300" aria-hidden="true" />
                  <span>{capability}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Trust notes
            </div>
            <ul className="m-0 grid list-none gap-1 p-0">
              {plugin.trustNotes.map(note => (
                <li key={note} className="flex min-w-0 items-start gap-2 text-sm leading-6 text-fd-muted-foreground">
                  <Check className="mt-1 size-3.5 shrink-0 !text-emerald-600 dark:!text-emerald-300" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <aside className="mt-auto flex flex-col gap-3 rounded-lg bg-fd-muted p-3">
        <div>
          <p className="m-0 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
            Owner
          </p>
          <p className="m-0 mt-1 break-words font-mono text-xs leading-5 text-fd-foreground">
            {plugin.owner}
          </p>
        </div>
        <div>
          <p className="m-0 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
            Namespace
          </p>
          <p className="m-0 mt-1 break-words font-mono text-xs leading-5 text-fd-foreground">
            {plugin.namespace}
          </p>
        </div>
        <div className="grid gap-2 pt-1">
          <a
            href={installUrl}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-fd-primary px-3 text-sm font-medium text-fd-primary-foreground no-underline transition-[background-color,transform] duration-150 hover:bg-fd-primary/90 active:scale-[0.96]"
          >
            <Plug className="size-4" aria-hidden="true" />
            Install
          </a>
          <button
            type="button"
            onClick={copyInstallUrl}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-fd-background px-3 text-sm font-medium text-fd-foreground shadow-sm transition-[background-color,transform] duration-150 hover:bg-fd-accent active:scale-[0.96]"
          >
            {copied
? (
              <Check className="size-4 !text-emerald-600 dark:!text-emerald-300" aria-hidden="true" />
            )
: (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a
            href={plugin.docsHref}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-fd-background px-3 text-sm font-medium text-fd-foreground no-underline shadow-sm transition-[background-color,transform] duration-150 hover:bg-fd-accent active:scale-[0.96]"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Docs
          </a>
        </div>
      </aside>
    </article>
  )
}

export function PluginMarketplace({ className }: { className?: string }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const filteredPlugins = useMemo(
    () =>
      pluginMarketplaceEntries.filter((plugin) => {
        const categoryMatches = category === 'all' || plugin.category === category
        return categoryMatches && matchesSearch(plugin, query)
      }),
    [category, query],
  )

  return (
    <div className={cn('not-prose my-8 flex flex-col gap-4', className)}>
      <MarketplaceHeader
        query={query}
        category={category}
        onQueryChange={setQuery}
        onCategoryChange={setCategory}
      />

      <div className="flex items-center justify-between gap-3 text-sm text-fd-muted-foreground">
        <span>
          <span className="font-medium tabular-nums text-fd-foreground">
            {filteredPlugins.length}
          </span>
{' '}
          plugins
        </span>
        <Link
          href="/api/plugin-marketplace"
          className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-fd-muted-foreground no-underline transition-[background-color,color,transform] duration-150 hover:bg-fd-muted hover:text-fd-foreground active:scale-[0.96]"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Registry JSON
        </Link>
      </div>

      {filteredPlugins.length > 0
? (
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPlugins.map(plugin => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
        </div>
      )
: (
        <div className="rounded-lg border border-dashed border-fd-border bg-fd-card p-6 text-center text-sm leading-6 text-fd-muted-foreground">
          No plugins match the current filters.
        </div>
      )}
    </div>
  )
}
