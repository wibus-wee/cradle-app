import { CheckLine as CheckIcon, WarningLine as WarningIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { PluginInstallStepHeader } from './plugin-install-step-header'
import { PluginSourceExampleChip } from './plugin-source-example-chip'
import type { ParsedPluginSource } from './plugin-source-parser'

interface PluginInstallPasteViewProps {
  input: string
  parsed: ParsedPluginSource | null
  looksLikeLocalPath: boolean
  pending: boolean
  onChange: (value: string) => void
  onPreview: () => void
  onCancel?: () => void
}

export function PluginInstallPasteView({
  input,
  parsed,
  looksLikeLocalPath,
  pending,
  onChange,
  onPreview,
  onCancel,
}: PluginInstallPasteViewProps) {
  const { t } = useTranslation('settings')
  const canSubmit = !!parsed && !pending
  const recognitionLabel = parsed
    ? parsed.kind === 'git'
      ? t('plugins.add.recognition.github')
      : t('plugins.add.recognition.npm')
    : input.trim().startsWith('cradle://')
      ? t('plugins.add.recognition.cradle')
      : null
  const hint = input.trim()
    ? looksLikeLocalPath
      ? t('plugins.add.localPathHint')
      : parsed
        ? null
        : t('plugins.add.invalidHint')
    : null

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onPreview()
      }}
    >
      <PluginInstallStepHeader current="source" />

      <div className="flex flex-col gap-1.5">
        <h4 className="text-[15px] leading-6 font-semibold text-foreground text-balance">
          {t('plugins.add.title')}
        </h4>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
          {t('plugins.add.description')}
        </p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-foreground/80">
          {t('plugins.add.inputLabel')}
        </span>
        <Input
          value={input}
          onChange={event => onChange(event.target.value)}
          placeholder={t('plugins.add.inputPlaceholder')}
          autoFocus
          spellCheck={false}
          className="h-11 text-[13.5px]"
        />
      </label>

      {recognitionLabel && parsed && (
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5',
            'animate-in fade-in slide-in-from-top-1 duration-200',
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-foreground">
              {recognitionLabel}
            </div>
            <div className="truncate font-mono text-[11.5px] text-muted-foreground">
              {parsed.location}
            </div>
          </div>
        </div>
      )}

      {hint && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed',
            'animate-in fade-in slide-in-from-top-1 duration-200',
            looksLikeLocalPath
              ? 'border-border/60 bg-muted/30 text-muted-foreground'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}
        >
          <WarningIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-pretty">{hint}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[11.5px] text-muted-foreground">
          {t('plugins.add.examplesLabel')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <PluginSourceExampleChip
            label={t('plugins.add.recognition.github')}
            value={t('plugins.add.example.github')}
            onPick={onChange}
          />
          <PluginSourceExampleChip
            label={t('plugins.add.recognition.npm')}
            value={t('plugins.add.example.npm')}
            onPick={onChange}
          />
          <PluginSourceExampleChip
            label={t('plugins.add.recognition.cradle')}
            value={t('plugins.add.example.cradle')}
            onPick={onChange}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            {t('plugins.add.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={!canSubmit} className="h-9 gap-1.5 px-4 text-[13px]">
          {pending && <Spinner className="size-3.5" />}
          {t('plugins.add.preview')}
        </Button>
      </div>
    </form>
  )
}
