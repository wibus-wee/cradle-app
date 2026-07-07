/**
 * C-end "Add plugin" dialog. Replaces the old dev-facing source form
 * (kind dropdown + location/ref/subPath/label fields) with a single smart
 * input that auto-detects cradle:// links, GitHub URLs, owner/repo
 * shorthand, and npm package names. See plugin-source-parser.ts.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { postPluginsSources } from '~/api-gen/sdk.gen'
import type { PostPluginsSourcesData, PostPluginsSourcesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

import { looksLikeLocalPath, parsePluginSourceInput } from './plugin-source-parser'

type AdvancedFields = { ref: string, subPath: string, label: string }

const EMPTY_ADVANCED: AdvancedFields = { ref: '', subPath: '', label: '' }

type AddStatus = 'idle' | 'installing' | 'success' | 'error'

function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

function syncDesktopSource(sourceId: string): void {
  void window.cradle?.plugins?.syncSource(sourceId).catch(() => undefined)
}

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

export interface AddPluginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddPluginDialog({ open, onOpenChange }: AddPluginDialogProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [input, setInput] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advanced, setAdvanced] = useState<AdvancedFields>(EMPTY_ADVANCED)
  const [status, setStatus] = useState<AddStatus>('idle')
  const [result, setResult] = useState<PostPluginsSourcesResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const parsed = useMemo(() => parsePluginSourceInput(input), [input])
  const inputLooksLikeLocalPath = useMemo(() => looksLikeLocalPath(input), [input])
  const canSubmit = !!parsed && status !== 'installing'

  const reset = () => {
    setInput('')
    setAdvancedOpen(false)
    setAdvanced(EMPTY_ADVANCED)
    setStatus('idle')
    setResult(null)
    setErrorMessage('')
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Allow closing after success/error without an extra confirm; just reset on close.
      reset()
    }
    onOpenChange(next)
  }

  const addMutation = useMutation({
    mutationFn: async (body: PostPluginsSourcesData['body']) => {
      const { data, error } = await postPluginsSources({ body })
      if (error) {
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }
      return data
    },
    onMutate: () => {
      setStatus('installing')
    },
    onSuccess: (data) => {
      setResult(data ?? null)
      setStatus('success')
      if (data?.source.id) {
        syncDesktopSource(data.source.id)
      }
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'sources'] })
      toastManager.add({ type: 'success', title: t('plugins.sources.toast.added') })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMessage(message)
      setStatus('error')
      toastManager.add({ type: 'error', title: t('plugins.sources.toast.addFailed') })
    },
  })

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!parsed) {
      return
    }
    const ref = nullableText(advanced.ref) ?? parsed.ref ?? null
    const subPath = nullableText(advanced.subPath) ?? parsed.subPath ?? null
    const label = nullableText(advanced.label)
    addMutation.mutate({
      kind: parsed.kind,
      location: parsed.location,
      ref,
      subPath,
      label,
      addedReason: 'Added from Settings.',
    })
  }

  const hint = input.trim()
    ? inputLooksLikeLocalPath
      ? t('plugins.add.localPathHint')
      : parsed
        ? null
        : t('plugins.add.invalidHint')
    : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('plugins.add.title')}</DialogTitle>
          <DialogDescription>{t('plugins.add.description')}</DialogDescription>
        </DialogHeader>

        {status === 'success' && result
          ? (
              <ResultStep
                result={result}
                onDone={() => handleOpenChange(false)}
              />
            )
          : status === 'error'
            ? (
                <ErrorStep
                  message={errorMessage}
                  onRetry={() => setStatus('idle')}
                  onCancel={() => handleOpenChange(false)}
                />
              )
            : (
                <form className="flex flex-col gap-3" onSubmit={submit}>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t('plugins.add.inputLabel')}
                    </span>
                    <Input
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      placeholder={t('plugins.add.inputPlaceholder')}
                      autoFocus
                      spellCheck={false}
                      className="h-9 text-[12.5px]"
                    />
                  </label>

                  {hint && (
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>
                  )}

                  <AdvancedSection
                    open={advancedOpen}
                    onToggle={() => setAdvancedOpen(v => !v)}
                    advanced={advanced}
                    onChange={patch => setAdvanced(current => ({ ...current, ...patch }))}
                  />

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenChange(false)}
                      disabled={status === 'installing'}
                    >
                      {t('plugins.add.done')}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!canSubmit}
                      className="gap-1.5"
                    >
                      {status === 'installing'
                        ? (
                            <>
                              <Spinner className="size-3.5" />
                              {t('plugins.add.installing')}
                            </>
                          )
                        : t('plugins.add.submit')}
                    </Button>
                  </DialogFooter>
                </form>
              )}
      </DialogContent>
    </Dialog>
  )
}

function AdvancedSection({
  open,
  onToggle,
  advanced,
  onChange,
}: {
  open: boolean
  onToggle: () => void
  advanced: AdvancedFields
  onChange: (patch: Partial<AdvancedFields>) => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="rounded-lg border border-border/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-[11.5px] font-medium text-muted-foreground transition hover:text-foreground"
      >
        {t('plugins.add.advancedToggle')}
        <span className={cn('transition-transform', open && 'rotate-90')}>›</span>
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-2 border-t border-border/50 p-3">
          <TextField
            label={t('plugins.add.ref')}
            value={advanced.ref}
            onChange={ref => onChange({ ref })}
            placeholder={t('plugins.add.refPlaceholder')}
          />
          <TextField
            label={t('plugins.add.subPath')}
            value={advanced.subPath}
            onChange={subPath => onChange({ subPath })}
            placeholder={t('plugins.add.subPathPlaceholder')}
          />
          <TextField
            label={t('plugins.add.label')}
            value={advanced.label}
            onChange={label => onChange({ label })}
            placeholder={t('plugins.add.labelPlaceholder')}
          />
        </div>
      )}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="h-8 text-[12px]"
      />
    </label>
  )
}

function ResultStep({
  result,
  onDone,
}: {
  result: PostPluginsSourcesResponse
  onDone: () => void
}) {
  const { t } = useTranslation('settings')
  const plugins = result.discoveredPlugins ?? []

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-[13px] font-medium text-foreground">{t('plugins.add.resultTitle')}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {t('plugins.add.resultHint')}
        </p>
      </div>

      {plugins.length === 0
        ? (
            <p className="rounded-md bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
              {t('plugins.add.resultEmpty')}
            </p>
          )
        : (
            <ul className="flex flex-col gap-2">
              {plugins.map(plugin => (
                <DiscoveredPluginRow key={plugin.routeSegment} plugin={plugin} />
              ))}
            </ul>
          )}

      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone}>
          {t('plugins.add.done')}
        </Button>
      </DialogFooter>
    </div>
  )
}

function DiscoveredPluginRow({ plugin }: { plugin: PostPluginsSourcesResponse['discoveredPlugins'][number] }) {
  const iconUrl = useMemo(() => resolveIconUrl(plugin.iconUrl), [plugin.iconUrl])
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border/50 px-3 py-2">
      <PluginIcon iconUrl={iconUrl} name={plugin.displayName || plugin.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {plugin.displayName || plugin.name}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            v
{plugin.version}
          </span>
        </div>
        {plugin.description && (
          <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">
            {plugin.description}
          </p>
        )}
      </div>
    </li>
  )
}

function PluginIcon({ iconUrl, name }: { iconUrl: string | null, name: string }) {
  const [failed, setFailed] = useState(false)
  if (iconUrl && !failed) {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-card">
        <img
          src={iconUrl}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-[12px] font-semibold text-foreground/80 select-none">
      {initial}
    </div>
  )
}

function ErrorStep({
  message,
  onRetry,
  onCancel,
}: {
  message: string
  onRetry: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-destructive/90">
        {t('plugins.add.resultError', { message })}
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('plugins.add.done')}
        </Button>
        <Button type="button" size="sm" onClick={onRetry}>
          {t('plugins.add.tryAgain')}
        </Button>
      </DialogFooter>
    </div>
  )
}
