import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'

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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onPreview()
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t('plugins.add.inputLabel')}
        </span>
        <Input
          value={input}
          onChange={event => onChange(event.target.value)}
          placeholder={t('plugins.add.inputPlaceholder')}
          autoFocus
          spellCheck={false}
          className="h-9 text-[12.5px]"
        />
      </label>

      {recognitionLabel && parsed && (
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="rounded-md bg-fill px-1.5 py-0.5 text-muted-foreground">
            {recognitionLabel}
          </span>
          <span className="truncate font-mono text-muted-foreground/80">
            {parsed.location}
          </span>
        </div>
      )}

      {hint && <p className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>}

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

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            {t('plugins.add.cancel')}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!canSubmit} className="gap-1.5">
          {pending && <Spinner className="size-3.5" />}
          {t('plugins.add.preview')}
        </Button>
      </div>
    </form>
  )
}
