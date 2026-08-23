import {
  ArrowLeftLine as ArrowLeftIcon,
  GithubLine as GithubIcon,
  PackageLine as NpmIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesPreviewResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { PluginInstallStepHeader } from './plugin-install-step-header'
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
      <div className="flex flex-col gap-4">
        <PluginInstallStepHeader current="review" />
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-10 text-center text-[12.5px] text-muted-foreground">
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
  const SourceKindIcon = preview.source.kind === 'git' ? GithubIcon : NpmIcon

  return (
    <div className="flex flex-col gap-4">
      <PluginInstallStepHeader current="review" />

      <div className="flex flex-col gap-1.5">
        <h4 className="text-[15px] leading-6 font-semibold text-foreground text-balance">
          {t('plugins.add.reviewTitle', { count: preview.plugins.length })}
        </h4>
      </div>

      <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-card text-muted-foreground">
          <SourceKindIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-foreground">
            {sourceLabel || preview.source.location}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {preview.source.location}
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-fill px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
          {preview.source.kind === 'git'
            ? t('plugins.add.recognition.github')
            : t('plugins.add.recognition.npm')}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={allSelected ? onSelectNone : onSelectAll}
          className="text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          {allSelected ? t('plugins.preview.select-none') : t('plugins.preview.select-all')}
        </button>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {t('plugins.preview.selected-n', { count: selected.size })}
        </span>
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
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <WarningIcon className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
          <ul className="flex flex-col gap-1">
            {preview.warnings.map(warning => (
              <li
                key={warning}
                className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-300"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={installing}>
          <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          {t('plugins.add.back')}
        </Button>
        <Button
          onClick={onInstall}
          disabled={selected.size === 0 || installing}
          className={cn('h-9 gap-1.5 px-4 text-[13px]')}
        >
          {installing && <Spinner className="size-3.5" />}
          {t('plugins.add.installN', { count: selected.size })}
        </Button>
      </div>
    </div>
  )
}
