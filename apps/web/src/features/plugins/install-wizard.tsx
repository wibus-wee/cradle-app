/**
 * Shared plugin install wizard (Plans 030/031).
 *
 * paste -> previewing -> review -> installing -> done (with per-plugin Enable
 * + undo) / error. Used in two modes:
 *  - Import tab: `mode="paste"` renders the smart input + live recognition.
 *  - Marketplace tab: `initialSource` is provided, so the wizard skips paste
 *    and starts at `previewing` (the entry's source is the input).
 *
 * Install reuses the preview's cached download (server-side `resolvePluginSourceDirectory`
 * hits the hash-keyed cache), so the tarball is fetched exactly once.
 * No `ref`/`subPath`/`label` fields are exposed in paste mode.
 */
import {
  ArrowLeftLine as ArrowLeftIcon,
  CheckLine as CheckIcon,
  Refresh2Line as RefreshIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deletePluginsSourcesById,
  patchPluginsByRouteSegmentEnabled,
  postPluginsSources,
  postPluginsSourcesPreview,
} from '~/api-gen/sdk.gen'
import type {
  PostPluginsSourcesPreviewResponse,
  PostPluginsSourcesResponse,
} from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { getServerUrl } from '~/lib/electron'

import { looksLikeLocalPath, parsePluginSourceInput } from './plugin-source-parser'
import { TrustConsentDialog } from './plugins-trust-consent-dialog'

export interface WizardSource {
  kind: 'git' | 'npm'
  location: string
  ref?: string | null
  subPath?: string | null
}

export interface InstallWizardProps {
  /** Pre-resolved source (Marketplace install). Skips the paste step. */
  initialSource?: WizardSource
  /** Display label for the source (e.g. marketplace entry name). */
  sourceLabel?: string
  /** Render the paste input + recognition (Import tab). Defaults to true when no initialSource. */
  mode?: 'paste' | 'source'
  /** Called when the flow is dismissed (done / cancel). */
  onDismiss?: () => void
}

type Step = 'paste' | 'previewing' | 'review' | 'installing' | 'done' | 'error'

type PreviewItem = PostPluginsSourcesPreviewResponse['plugins'][number]
type InstalledDescriptor = PostPluginsSourcesResponse['discoveredPlugins'][number]

function syncDesktopSource(sourceId: string): void {
  void window.cradle?.plugins?.syncSource(sourceId).catch(() => undefined)
}

function unsyncDesktopPlugins(plugins: Array<{ identity: string, hasDesktop: boolean }>): void {
  for (const plugin of plugins) {
    if (plugin.hasDesktop) {
      void window.cradle?.plugins?.unsyncSource(plugin.identity).catch(() => undefined)
    }
  }
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

function extractError(error: unknown): { status?: number, message: string } {
  if (typeof error === 'string') {
    return { message: error }
  }
  if (error && typeof error === 'object') {
    const raw = error as Record<string, unknown>
    const status = typeof raw.status === 'number' ? raw.status : undefined
    const nested = raw.error as Record<string, unknown> | undefined
    const message = (typeof raw.message === 'string' && raw.message)
      || (nested && typeof nested.message === 'string' && nested.message)
      || JSON.stringify(error)
    return { status, message }
  }
  return { message: String(error) }
}

function mapPluginError(error: unknown, t: TFunction<'settings'>): string {
  const { status, message } = extractError(error)
  const lower = message.toLowerCase()
  if (status === 404 || lower.includes('not found')) {
    return t('plugins.add.error.repoNotFound')
  }
  if (lower.includes('no plugins') || lower.includes('no cradle') || lower.includes('didn\'t find') || lower.includes('did not find')) {
    return t('plugins.add.error.noPlugins')
  }
  if ((status && status >= 500) || lower.includes('network') || lower.includes('failed to fetch') || lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('enotfound')) {
    return t('plugins.add.error.network')
  }
  return message
}

function sourceBody(source: WizardSource) {
  return {
    kind: source.kind,
    location: source.location,
    ref: source.ref ?? null,
    subPath: source.subPath ?? null,
  }
}

export function InstallWizard({ initialSource, sourceLabel, mode, onDismiss }: InstallWizardProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const pasteMode = mode === 'paste' || (!mode && !initialSource)
  const [step, setStep] = useState<Step>(initialSource ? 'previewing' : 'paste')
  const [input, setInput] = useState('')
  const [activeSource, setActiveSource] = useState<WizardSource | null>(initialSource ?? null)
  const [preview, setPreview] = useState<PostPluginsSourcesPreviewResponse | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [installResult, setInstallResult] = useState<PostPluginsSourcesResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [trustTarget, setTrustTarget] = useState<string | null>(null)

  const parsed = useMemo(() => parsePluginSourceInput(input), [input])
  const inputLooksLikeLocalPath = useMemo(() => looksLikeLocalPath(input), [input])

  const previewMutation = useMutation({
    mutationFn: async (source: WizardSource) => {
      const { data, error } = await postPluginsSourcesPreview({ body: sourceBody(source) })
      if (error) {
        throw error
      }
      return data as PostPluginsSourcesPreviewResponse
    },
    onMutate: () => setStep('previewing'),
    onSuccess: (data) => {
      setPreview(data)
      setSelected(new Set(data.plugins.map((_, index) => index)))
      setStep('review')
    },
    onError: (err) => {
      setErrorMessage(mapPluginError(err, t))
      setStep('error')
    },
  })

  // Marketplace mode: kick off the preview once on mount.
  useEffect(() => {
    if (initialSource) {
      setActiveSource(initialSource)
      previewMutation.mutate(initialSource)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installMutation = useMutation({
    mutationFn: async (source: WizardSource) => {
      const { data, error } = await postPluginsSources({
        body: { ...sourceBody(source), label: null, addedReason: 'Added via Settings preview flow.' },
      })
      if (error) {
        throw error
      }
      return data as PostPluginsSourcesResponse
    },
    onMutate: () => setStep('installing'),
    onSuccess: (data) => {
      setInstallResult(data)
      if (data?.source.id) {
        syncDesktopSource(data.source.id)
      }
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'sources'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'marketplace'] })
      toastManager.add({ type: 'success', title: t('plugins.sources.toast.added') })
      setStep('done')
    },
    onError: (err) => {
      setErrorMessage(mapPluginError(err, t))
      setStep('error')
    },
  })

  const enableMutation = useMutation({
    mutationFn: async (routeSegment: string) => {
      const { error } = await patchPluginsByRouteSegmentEnabled({
        path: { routeSegment },
        body: { enabled: true },
      })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      toastManager.add({ type: 'success', title: t('plugins.toast.enabled') })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('plugins.toast.toggleFailed') })
    },
    onSettled: () => {
      setTrustTarget(null)
    },
  })

  const undoMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { error } = await deletePluginsSourcesById({ path: { id: sourceId } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      if (installResult?.discoveredPlugins) {
        unsyncDesktopPlugins(installResult.discoveredPlugins)
      }
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'sources'] })
      void queryClient.invalidateQueries({ queryKey: ['plugins', 'marketplace'] })
      toastManager.add({ type: 'success', title: t('plugins.sources.toast.removed') })
      onDismiss?.()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('plugins.sources.toast.removeFailed') })
    },
  })

  const handlePreview = () => {
    if (!parsed) {
      return
    }
    setActiveSource(parsed)
    previewMutation.mutate(parsed)
  }

  const handleInstall = () => {
    if (!activeSource || selected.size === 0) {
      return
    }
    installMutation.mutate(activeSource)
  }

  const handleEnable = (plugin: InstalledDescriptor) => {
    const untrustedExternal = plugin.source.kind === 'externalLocal' && !plugin.source.trusted
    if (untrustedExternal) {
      setTrustTarget(plugin.routeSegment)
      return
    }
    enableMutation.mutate(plugin.routeSegment)
  }

  const toggleSelected = (index: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      }
      else {
        next.add(index)
      }
      return next
    })
  }

  const sourceDisplayName = sourceLabel ?? activeSource?.location ?? ''

  return (
    <div className="flex flex-col gap-3">
      {step === 'paste' && pasteMode && (
        <PasteStep
          input={input}
          onChange={setInput}
          parsed={parsed}
          looksLikeLocalPath={inputLooksLikeLocalPath}
          onPreview={handlePreview}
          onCancel={onDismiss}
          pending={previewMutation.isPending}
        />
      )}

      {step === 'previewing' && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
          <Spinner className="size-3.5" />
          {t('plugins.add.resolving')}
        </div>
      )}

      {step === 'review' && preview && (
        <ReviewStep
          preview={preview}
          selected={selected}
          sourceLabel={sourceDisplayName}
          onToggle={toggleSelected}
          onSelectAll={() => setSelected(new Set(preview.plugins.map((_, index) => index)))}
          onSelectNone={() => setSelected(new Set())}
          onBack={pasteMode ? () => setStep('paste') : () => onDismiss?.()}
          onInstall={handleInstall}
          installing={installMutation.isPending}
        />
      )}

      {step === 'installing' && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
          <Spinner className="size-3.5" />
          {t('plugins.add.installing')}
        </div>
      )}

      {step === 'done' && installResult && (
        <DoneStep
          result={installResult}
          enablingRouteSegment={enableMutation.isPending ? enableMutation.variables ?? null : null}
          onEnable={handleEnable}
          onUndo={() => installResult.source.id && undoMutation.mutate(installResult.source.id)}
          undoing={undoMutation.isPending}
          onDone={onDismiss}
        />
      )}

      {step === 'error' && (
        <ErrorStep
          message={errorMessage}
          onRetry={() => {
            if (activeSource) {
              previewMutation.mutate(activeSource)
            }
            else {
              setStep('paste')
            }
          }}
          onCancel={onDismiss}
        />
      )}

      <TrustConsentDialog
        routeSegment={trustTarget}
        onConfirm={() => trustTarget && enableMutation.mutate(trustTarget)}
        onCancel={() => setTrustTarget(null)}
        confirmPending={enableMutation.isPending}
      />
    </div>
  )
}

function PasteStep({
  input,
  onChange,
  parsed,
  looksLikeLocalPath: isLocalPath,
  onPreview,
  onCancel,
  pending,
}: {
  input: string
  onChange: (value: string) => void
  parsed: ReturnType<typeof parsePluginSourceInput>
  looksLikeLocalPath: boolean
  onPreview: () => void
  onCancel?: () => void
  pending: boolean
}) {
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
    ? isLocalPath
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
        <span className="text-[11px] font-medium text-muted-foreground">{t('plugins.add.inputLabel')}</span>
        <Input
          value={input}
          onChange={e => onChange(e.target.value)}
          placeholder={t('plugins.add.inputPlaceholder')}
          autoFocus
          spellCheck={false}
          className="h-9 text-[12.5px]"
        />
      </label>

      {recognitionLabel && parsed && (
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="rounded-md bg-fill px-1.5 py-0.5 text-muted-foreground">{recognitionLabel}</span>
          <span className="truncate font-mono text-muted-foreground/80">{parsed.location}</span>
        </div>
      )}

      {hint && (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <ExampleChip label={t('plugins.add.recognition.github')} value={t('plugins.add.example.github')} onPick={onChange} />
        <ExampleChip label={t('plugins.add.recognition.npm')} value={t('plugins.add.example.npm')} onPick={onChange} />
        <ExampleChip label={t('plugins.add.recognition.cradle')} value={t('plugins.add.example.cradle')} onPick={onChange} />
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            {t('plugins.add.cancel')}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!canSubmit} className="gap-1.5">
          {pending ? <Spinner className="size-3.5" /> : null}
          {t('plugins.add.preview')}
        </Button>
      </div>
    </form>
  )
}

function ExampleChip({ label, value, onPick }: { label: string, value: string, onPick: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className="rounded-md border border-border/60 bg-card px-2 py-1 text-left text-[10.5px] text-muted-foreground transition hover:text-foreground"
    >
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="ml-1 font-mono">{value}</span>
    </button>
  )
}

function ReviewStep({
  preview,
  selected,
  sourceLabel,
  onToggle,
  onSelectAll,
  onSelectNone,
  onBack,
  onInstall,
  installing,
}: {
  preview: PostPluginsSourcesPreviewResponse
  selected: Set<number>
  sourceLabel: string
  onToggle: (index: number) => void
  onSelectAll: () => void
  onSelectNone: () => void
  onBack: () => void
  onInstall: () => void
  installing: boolean
}) {
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
          <span className="font-medium text-foreground">{sourceLabel || preview.source.location}</span>
          <span className="rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">
            {preview.source.kind === 'git' ? t('plugins.add.recognition.github') : t('plugins.add.recognition.npm')}
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
          <PreviewPluginRow
            key={`${plugin.name}-${index}`}
            plugin={plugin}
            checked={selected.has(index)}
            onToggle={() => onToggle(index)}
          />
        ))}
      </ul>

      {preview.warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {preview.warnings.map((warning, index) => (
            <li key={index} className="text-[11px] text-muted-foreground/80">
·
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
        <Button size="sm" onClick={onInstall} disabled={selected.size === 0 || installing} className="gap-1.5">
          {installing ? <Spinner className="size-3.5" /> : null}
          {t('plugins.add.installN', { count: selected.size })}
        </Button>
      </div>
    </div>
  )
}

function PreviewPluginRow({
  plugin,
  checked,
  onToggle,
}: {
  plugin: PreviewItem
  checked: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation('settings')
  return (
    <li className="flex items-start gap-2.5 rounded-md border border-border/50 px-3 py-2">
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" aria-label={plugin.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">{plugin.displayName}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
v
{plugin.version}
          </span>
        </div>
        {plugin.description && (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{plugin.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {plugin.trusted
            ? (
                <span className="text-[10.5px] text-muted-foreground">
✓
{t('plugins.preview.trusted')}
                </span>
              )
            : (
                <span className="text-[10.5px] text-amber-600 dark:text-amber-300" title={plugin.trustReason ?? undefined}>
                  ⚠
{' '}
{t('plugins.preview.untrusted')}
{' '}
·
{' '}
{t('plugins.preview.untrustedHint')}
                </span>
              )}
          {plugin.declaredPermissions.length > 0 && (
            <span className="text-[10.5px] text-muted-foreground">
              {t('plugins.preview.permissions', { count: plugin.declaredPermissions.length })}
            </span>
          )}
        </div>
        {plugin.warnings.length > 0 && (
          <p className="mt-1 text-[10.5px] text-muted-foreground/80">{plugin.warnings.join(' · ')}</p>
        )}
      </div>
    </li>
  )
}

function DoneStep({
  result,
  enablingRouteSegment,
  onEnable,
  onUndo,
  undoing,
  onDone,
}: {
  result: PostPluginsSourcesResponse
  enablingRouteSegment: string | null
  onEnable: (plugin: InstalledDescriptor) => void
  onUndo: () => void
  undoing: boolean
  onDone?: () => void
}) {
  const { t } = useTranslation('settings')
  const plugins = result.discoveredPlugins

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-[13px] font-medium text-foreground">{t('plugins.add.resultTitle')}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t('plugins.add.resultHint')}</p>
      </div>

      {plugins.length === 0
        ? (
            <p className="rounded-md bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">{t('plugins.add.resultEmpty')}</p>
          )
        : (
            <ul className="flex flex-col gap-2">
              {plugins.map(plugin => (
                <InstalledPluginRow
                  key={plugin.routeSegment}
                  plugin={plugin}
                  enabling={enablingRouteSegment === plugin.routeSegment}
                  onEnable={() => onEnable(plugin)}
                />
              ))}
            </ul>
          )}

      <div className="flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onUndo} disabled={undoing} className="gap-1.5">
          {undoing ? <Spinner className="size-3.5" /> : null}
          {t('plugins.add.undo')}
        </Button>
        <Button size="sm" onClick={onDone}>{t('plugins.add.done')}</Button>
      </div>
    </div>
  )
}

function InstalledPluginRow({
  plugin,
  enabling,
  onEnable,
}: {
  plugin: InstalledDescriptor
  enabling: boolean
  onEnable: () => void
}) {
  const { t } = useTranslation('settings')
  const iconUrl = useMemo(() => resolveIconUrl(plugin.iconUrl), [plugin.iconUrl])
  const enabled = plugin.activation.enabled
  const untrustedExternal = plugin.source.kind === 'externalLocal' && !plugin.source.trusted

  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border/50 px-3 py-2">
      <PluginAvatar iconUrl={iconUrl} name={plugin.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">{plugin.displayName}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
v
{plugin.version}
          </span>
        </div>
        {untrustedExternal && !enabled && (
          <p className="mt-0.5 text-[10.5px] text-amber-600 dark:text-amber-300">{t('plugins.needsTrust')}</p>
        )}
      </div>
      {enabled
        ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              {t('plugins.preview.trusted')}
            </span>
          )
        : (
            <Button size="sm" variant="outline" onClick={onEnable} disabled={enabling} className="h-7 gap-1.5">
              {enabling ? <Spinner className="size-3" /> : null}
              {t('plugins.marketplace.enable')}
            </Button>
          )}
    </li>
  )
}

function ErrorStep({
  message,
  onRetry,
  onCancel,
}: {
  message: string
  onRetry: () => void
  onCancel?: () => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-destructive/90">{message}</p>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('plugins.add.cancel')}
          </Button>
        )}
        <Button size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshIcon className="size-3.5" aria-hidden="true" />
          {t('plugins.add.retry')}
        </Button>
      </div>
    </div>
  )
}

function PluginAvatar({ iconUrl, name }: { iconUrl: string | null, name: string }) {
  const [failed, setFailed] = useState(false)
  if (iconUrl && !failed) {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-card">
        <img src={iconUrl} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      </div>
    )
  }
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-[12px] font-semibold text-foreground/80 select-none" aria-hidden="true">
      {initial}
    </div>
  )
}
