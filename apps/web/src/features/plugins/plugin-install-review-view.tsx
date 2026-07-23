import { ArrowLeftLine as ArrowLeftIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesPreviewResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

import { PluginPreviewRowView } from './plugin-preview-row-view'

interface PluginInstallReviewViewProps {
  preview: PostPluginsSourcesPreviewResponse
  selected: Set<number>
  sourceLabel: string
  installing: boolean
  onToggle: (index: number) => void
  onSelectAll: () => void
  onSelectNone: () => void
  onBack: () => void
  onInstall: () => void
}

export function PluginInstallReviewView({
  preview,
  selected,
  sourceLabel,
  installing,
  onToggle,
  onSelectAll,
  onSelectNone,
  onBack,
  onInstall,
}: PluginInstallReviewViewProps) {
  const { t } = useTranslation('settings')

  if (preview.plugins.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
          {t('plugins.preview.empty')}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            {t('plugins.add.back')}
          </Button>
        </div>
      </div>
    )
  }

  const allSelected = selected.size === preview.plugins.length

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-medium text-foreground">
            {sourceLabel || preview.source.location}
          </span>
          <span className="rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">
            {preview.source.kind === 'git'
              ? t('plugins.add.recognition.github')
              : t('plugins.add.recognition.npm')}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={allSelected ? onSelectNone : onSelectAll}
          className="text-[11.5px] text-muted-foreground transition hover:text-foreground"
        >
          {t('plugins.preview.select-all')}
          {' '}
          (
{t('plugins.preview.selected-n', { count: selected.size })}
)
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {preview.plugins.map((plugin, index) => (
          <PluginPreviewRowView
            key={plugin.name}
            plugin={plugin}
            checked={selected.has(index)}
            onToggle={() => onToggle(index)}
          />
        ))}
      </ul>

      {preview.warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {preview.warnings.map(warning => (
            <li key={warning} className="text-[11px] text-muted-foreground/80">
              {warning}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={installing}>
          <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          {t('plugins.add.back')}
        </Button>
        <Button
          size="sm"
          onClick={onInstall}
          disabled={selected.size === 0 || installing}
          className="gap-1.5"
        >
          {installing && <Spinner className="size-3.5" />}
          {t('plugins.add.installN', { count: selected.size })}
        </Button>
      </div>
    </div>
  )
}
