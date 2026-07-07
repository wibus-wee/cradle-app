import {
  Refresh1Line as RefreshCwIcon,
  SearchLine as SearchIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { modelIsVisible, ModelVisibilitySchema } from '~/features/agent-runtime/model-visibility'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import { ModelRegistryMappingDialog } from '../model-registry/mapping-dialog'
import type { SearchResult } from '../model-registry/schemas'
import { ALL_DISABLED_SENTINEL } from './provider-settings-utils'

type TimeAgoMessage
  = | { key: 'models.time.justNow' }
    | { key: 'models.time.minutesAgo', options: { minuteCount: number } }
    | { key: 'models.time.hoursAgo', options: { hourCount: number } }
    | { key: 'models.time.daysAgo', options: { dayCount: number } }

function formatTimeAgo(ts: number): TimeAgoMessage {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 60) {
    return { key: 'models.time.justNow' }
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return { key: 'models.time.minutesAgo', options: { minuteCount: minutes } }
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return { key: 'models.time.hoursAgo', options: { hourCount: hours } }
  }
  const days = Math.round(hours / 24)
  return { key: 'models.time.daysAgo', options: { dayCount: days } }
}

function renderTimeAgo(message: TimeAgoMessage, t: TFunction<'agentManagement'>): string {
  switch (message.key) {
    case 'models.time.justNow':
      return t('models.time.justNow')
    case 'models.time.minutesAgo':
      return t('models.time.minutesAgo', message.options)
    case 'models.time.hoursAgo':
      return t('models.time.hoursAgo', message.options)
    case 'models.time.daysAgo':
      return t('models.time.daysAgo', message.options)
  }
}

function occurrenceKey(id: string, counts: Map<string, number>): string {
  const count = counts.get(id) ?? 0
  counts.set(id, count + 1)
  return `${id}:${count}`
}

function applyRegistryResult(
  model: ModelDescriptor,
  result: SearchResult,
  match: 'manual' | 'alias',
): ModelDescriptor {
  return {
    ...model,
    label: result.label || model.label,
    capabilities: {
      ...result.capabilities,
      ...model.capabilities,
      registryMatch: match,
      registryModelId: result.id,
      registryModelLabel: result.label || result.id,
    },
  }
}

type RegistryStatus = 'exact' | 'fuzzy' | 'manual' | 'alias' | 'unmatched'

function registryStatusLabel(model: ModelDescriptor): RegistryStatus {
  switch (model.capabilities.registryMatch) {
    case 'exact':
      return 'exact'
    case 'fuzzy':
      return 'fuzzy'
    case 'manual':
      return 'manual'
    case 'alias':
      return 'alias'
    default:
      return 'unmatched'
  }
}

const REGISTRY_STATUS_KEYS = {
  exact: 'models.registry.status.exact',
  fuzzy: 'models.registry.status.fuzzy',
  manual: 'models.registry.status.manual',
  alias: 'models.registry.status.alias',
  unmatched: 'models.registry.status.unmatched',
} as const

export function ModelsPanel({
  loading,
  models,
  enabledModels,
  onChange,
  onModelRegistryMapped,
  onRefresh,
  cachedAt,
}: {
  loading: boolean
  models: ModelDescriptor[]
  enabledModels: string[]
  onChange: (next: string[]) => void
  onModelRegistryMapped: (next: ModelDescriptor) => void
  onRefresh?: () => void
  cachedAt?: number | null
}) {
  const { t } = useTranslation('agentManagement')
  const [filter, setFilter] = useState('')
  const [mappingModel, setMappingModel] = useState<ModelDescriptor | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const visibility = ModelVisibilitySchema.parse(enabledModels)
  const allDisabled = visibility.kind === 'none'
  const isExplicitSelection = visibility.kind === 'list'

  const visible = (() => {
    let filtered = models
    if (filter.trim()) {
      const q = filter.toLowerCase()
      filtered = models.filter(m => (m.label || m.id).toLowerCase().includes(q))
    }
    // Sort: enabled first, then alphabetical within each group
    return filtered.toSorted((a, b) => {
      const aEnabled = modelIsVisible(visibility, a.id)
      const bEnabled = modelIsVisible(visibility, b.id)
      if (aEnabled !== bEnabled) {
        return aEnabled ? -1 : 1
      }
      return (a.label || a.id).localeCompare(b.label || b.id)
    })
  })()

  const enabledCount
    = visibility.kind === 'none'
      ? 0
      : visibility.kind === 'all'
        ? models.length
        : models.filter(model => visibility.ids.has(model.id)).length

  const isChecked = (id: string): boolean => {
    return modelIsVisible(visibility, id)
  }

  const handleToggle = (id: string, checked: boolean) => {
    if (checked) {
      // Enabling a model
      if (allDisabled) {
        // From "all disabled" → enable only this one
        onChange([id])
      }
 else if (visibility.kind === 'all') {
        // "All enabled" state — shouldn't normally check an already-checked item,
        // but just in case, keep all enabled (no-op)
      }
 else {
        // Explicit selection — add this model
        onChange([...enabledModels, id])
      }
    }
 else {
      // Disabling a model
      const base = visibility.kind === 'all' ? models.map(m => m.id) : enabledModels
      const next = base.filter(x => x !== id)
      onChange(next.length === 0 ? [ALL_DISABLED_SENTINEL] : next)
    }
  }

  const openMappingDialog = (model: ModelDescriptor) => {
    setMappingModel(model)
    setDialogOpen(true)
  }

  const modelKeyCounts = new Map<string, number>()

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-foreground">{t('models.header.title')}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('models.header.description')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onRefresh && models.length > 0 && !loading && (
            <Button
              size="xs"
              variant="ghost"
              className="gap-1 text-[11px] text-muted-foreground"
              onClick={onRefresh}
            >
              <RefreshCwIcon className="size-3" />
              {t('models.action.refresh')}
            </Button>
          )}
          {(isExplicitSelection || allDisabled) && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              {t('models.action.showAll')}
            </Button>
          )}
          {!allDisabled && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([ALL_DISABLED_SENTINEL])}
            >
              {t('models.action.disableAll')}
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('models.search.placeholder')}
          className="h-8 pl-8 text-[12.5px]"
        />
      </div>

      {/* Body */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
        {loading
? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
            <Spinner className="size-3" />
            {t('models.loading')}
          </div>
        )
: models.length === 0
? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">{t('models.empty.title')}</p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              {t('models.empty.description')}
            </p>
            {onRefresh && (
              <Button
                size="xs"
                variant="outline"
                className="mt-3 gap-1.5 text-[11px]"
                onClick={onRefresh}
              >
                <RefreshCwIcon className="size-3" />
                {t('models.action.fetchModels')}
              </Button>
            )}
          </div>
        )
: (
          <div className="max-h-72 overflow-y-auto">
            <ul className="divide-y divide-foreground/4">
              {visible.map((m) => {
                const checked = isChecked(m.id)
                const registryStatus = registryStatusLabel(m)
                return (
                  <li key={occurrenceKey(m.id, modelKeyCounts)}>
                    <div
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 transition-colors',
                        'hover:bg-foreground/2.5',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={c => handleToggle(m.id, !!c)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-foreground">
                          {m.label || m.id}
                        </div>
                        {m.label && m.label !== m.id && (
                          <div className="truncate font-mono text-[10.5px] text-muted-foreground/70">
                            {m.id}
                          </div>
                        )}
                        {m.capabilities.registryModelId
                          && m.capabilities.registryModelId !== m.id && (
                            <div className="truncate text-[10.5px] text-muted-foreground/70">
                              models.dev:
{' '}
                              <span className="font-mono">{m.capabilities.registryModelId}</span>
                            </div>
                          )}
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px] font-normal tabular-nums',
                          registryStatus === 'exact'
                          && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                          registryStatus === 'fuzzy'
                          && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                          registryStatus === 'manual'
                          && 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
                          registryStatus === 'unmatched' && 'text-muted-foreground',
                        )}
                      >
                        {t(REGISTRY_STATUS_KEYS[registryStatus])}
                      </Badge>
                      {m.capabilities.contextWindow != null && m.capabilities.contextWindow > 0 && (
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground"
                        >
                          {Math.round(m.capabilities.contextWindow / 1000)}
k
                        </Badge>
                      )}
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => openMappingDialog(m)}
                        aria-label={t('models.mapping.mapAria', { modelId: m.id })}
                        title={t('models.mapping.mapTitle')}
                        className="text-muted-foreground/60 hover:text-foreground"
                      >
                        <SparklesIcon className="size-3" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                )
              })}
              {visible.length === 0 && (
                <li className="px-4 py-8 text-center text-[11.5px] text-muted-foreground">
                  {t('models.search.noMatches.prefix')}
{' '}
                  <span className="font-mono text-foreground">{filter}</span>
                  {t('models.search.noMatches.suffix')}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {mappingModel && (
        <ModelRegistryMappingDialog
          key={mappingModel.id}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          modelId={mappingModel.id}
          modelLabel={mappingModel.label || mappingModel.id}
          initialSearchQuery={mappingModel.capabilities.registryModelId ?? mappingModel.id}
          onSaved={(_modelId, result, matchType) => {
            onModelRegistryMapped(applyRegistryResult(mappingModel, result, matchType))
          }}
        />
      )}

      {/* Footer summary */}
      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>
          {allDisabled
            ? t('models.summary.allHidden')
            : visibility.kind === 'all'
              ? t('models.summary.allVisible', { modelCount: models.length })
              : t('models.summary.someVisible', { enabledCount, totalCount: models.length })}
        </span>
        {cachedAt
          && models.length > 0
          && (() => {
            const timeAgo = formatTimeAgo(cachedAt)
            return (
              <span className="text-[10.5px] text-muted-foreground/60">
                {t('models.summary.cached', {
                  timeAgo: renderTimeAgo(timeAgo, t),
                })}
              </span>
            )
          })()}
      </div>
    </div>
  )
}
