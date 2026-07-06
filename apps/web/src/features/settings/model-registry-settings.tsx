import {
  CylinderLine as DatabaseIcon,
  DeleteLine as Trash2Icon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getModelRegistryMappingsOptions,
  getModelRegistryMappingsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { deleteModelRegistryMappingsByModelId } from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { formatTokenCount } from '~/lib/number-format'

import { ModelRegistryMappingDialog } from '../model-registry/mapping-dialog'
import type { ModelRegistryMapping } from '../model-registry/schemas'
import { SettingsGroup, SettingsPage } from './settings-container'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

function MappingMeta({ mapping }: { mapping: ModelRegistryMapping }) {
  const { t } = useTranslation('settings')
  const parts: Array<{ label: string, value: string }> = []

  parts.push({
    label: t('registry.detail.registryModelId' as SettingsKey),
    value: mapping.registryModelId,
  })
  if (mapping.model?.family) {
    parts.push({ label: t('registry.detail.family' as SettingsKey), value: mapping.model.family })
  }
  if (mapping.model?.limit?.context) {
    parts.push({
      label: t('registry.detail.contextWindow' as SettingsKey),
      value: formatTokenCount(mapping.model.limit.context),
    })
  }
  if (mapping.model?.cost) {
    const cost = mapping.model.cost
    if (cost.input != null) {
      parts.push({ label: 'in', value: `$${cost.input}/1M` })
    }
    if (cost.output != null) {
      parts.push({ label: 'out', value: `$${cost.output}/1M` })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
      {parts.map(part => (
        <span key={`${part.label}:${part.value}`} className="inline-flex items-center gap-1">
          <span className="text-muted-foreground/55">{part.label}</span>
          <span className="font-mono text-foreground/75">{part.value}</span>
        </span>
      ))}
    </div>
  )
}

function MappingRow({
  mapping,
  deleting,
  onEdit,
  onDelete,
}: {
  mapping: ModelRegistryMapping
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('settings')

  return (
    <div
      data-testid={`mapping-row-${mapping.modelId}`}
      className="group flex items-start gap-3 px-3.5 py-3"
    >
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <DatabaseIcon className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[12.5px] font-medium text-foreground">
            {mapping.modelId}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[9px] font-normal',
              mapping.matchType === 'manual'
                ? 'border-blue-500/30 text-blue-600 dark:text-blue-400'
                : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
            )}
          >
            {t(`registry.match.${mapping.matchType}` as SettingsKey)}
          </Badge>
          {mapping.model?.name && mapping.model.name !== mapping.modelId && (
            <span className="truncate text-[11.5px] text-muted-foreground/80">
              {mapping.model.name}
            </span>
          )}
        </div>
        <MappingMeta mapping={mapping} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onEdit}
          aria-label={t('registry.action.edit' as SettingsKey)}
        >
          <PencilIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onDelete}
          disabled={deleting}
          aria-label={t('registry.action.delete' as SettingsKey)}
        >
          {deleting
            ? <Spinner className="size-3.5" />
            : <Trash2Icon className="size-3.5" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  )
}

export function ModelRegistrySettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<ModelRegistryMapping | null>(null)

  const { data: mappings = [], isLoading } = useQuery(getModelRegistryMappingsOptions())

  const filteredMappings = (() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return mappings
    }
    return mappings.filter(
      mapping =>
        mapping.modelId.toLowerCase().includes(needle)
        || mapping.registryModelId.toLowerCase().includes(needle)
        || mapping.model?.name?.toLowerCase().includes(needle),
    )
  })()

  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      await deleteModelRegistryMappingsByModelId({
        path: { modelId: id },
        throwOnError: true,
      })
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('registry.status.deleted' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getModelRegistryMappingsQueryKey() })
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('registry.status.deleteFailed' as SettingsKey),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  return (
    <SettingsPage
      title={t('registry.page.title' as SettingsKey)}
      description={t('registry.page.description' as SettingsKey)}
      action={(
        <Button data-testid="add-mapping-btn" size="sm" onClick={() => setDialogOpen(true)}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('registry.add.label' as SettingsKey)}
        </Button>
      )}
      data-testid="model-registry-settings"
    >
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" aria-hidden="true" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('registry.search.placeholder' as SettingsKey)}
          className="h-9 pl-8 pr-2 text-[12.5px]"
        />
      </div>

      {isLoading
        ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('registry.loading' as SettingsKey)}
            </div>
          )
        : filteredMappings.length === 0
          ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-10 text-center">
                <DatabaseIcon className="size-5 !text-muted-foreground/40" aria-hidden="true" />
                <p className="text-[12px] text-muted-foreground/70">
                  {query
                    ? t('registry.search.noMatches' as SettingsKey)
                    : t('registry.empty' as SettingsKey)}
                </p>
                {!query && (
                  <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                    {t('registry.add.label' as SettingsKey)}
                  </Button>
                )}
              </div>
            )
          : (
              <SettingsGroup bare className="[&>*+*]:border-t [&>*+*]:border-border/60">
                {filteredMappings.map(mapping => (
                  <MappingRow
                    key={mapping.modelId}
                    mapping={mapping}
                    deleting={deleteMapping.isPending && deleteMapping.variables === mapping.modelId}
                    onEdit={() => setEditingMapping(mapping)}
                    onDelete={() => deleteMapping.mutate(mapping.modelId)}
                  />
                ))}
              </SettingsGroup>
            )}

      {/* Add mapping dialog */}
      <ModelRegistryMappingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        modelId=""
        modelIdEditable
      />

      {/* Edit mapping dialog */}
      {editingMapping && (
        <ModelRegistryMappingDialog
          open={!!editingMapping}
          onOpenChange={(open) => {
            if (!open) {
              setEditingMapping(null)
            }
          }}
          modelId={editingMapping.modelId}
          modelLabel={editingMapping.model?.name}
          initialSearchQuery={editingMapping.registryModelId}
          initialMode="manual"
          initialRegistryModel={editingMapping.model}
        />
      )}
    </SettingsPage>
  )
}
