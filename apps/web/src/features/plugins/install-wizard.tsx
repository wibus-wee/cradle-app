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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deletePluginsSourcesById,
  getPluginsSourcesByIdUninstallPlan,
  patchPluginsByRouteSegmentEnabled,
  postPluginsSources,
  postPluginsSourcesPreview,
} from '~/api-gen/sdk.gen'
import type {
  PostPluginsSourcesPreviewResponse,
  PostPluginsSourcesResponse,
} from '~/api-gen/types.gen'
import { toastManager } from '~/components/ui/toast'
import { getServerUrl } from '~/lib/electron'

import { PluginInstallDoneView } from './plugin-install-done-view'
import { PluginInstallErrorView } from './plugin-install-error-view'
import { PluginInstallPasteView } from './plugin-install-paste-view'
import { PluginInstallProgressView } from './plugin-install-progress-view'
import { PluginInstallReviewView } from './plugin-install-review-view'
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
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
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
      const { data: plan, error: planError } = await getPluginsSourcesByIdUninstallPlan({ path: { id: sourceId } })
      if (planError || !plan || plan.blocked) {
        throw planError ?? new Error('Plugin uninstall is blocked.')
      }
      const { error } = await deletePluginsSourcesById({
        path: { id: sourceId },
        body: { confirmationToken: plan.confirmationToken },
      })
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
        <PluginInstallPasteView
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
        <PluginInstallProgressView label={t('plugins.add.resolving')} />
      )}

      {step === 'review' && preview && (
        <PluginInstallReviewView
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
        <PluginInstallProgressView label={t('plugins.add.installing')} />
      )}

      {step === 'done' && installResult && (
        <PluginInstallDoneView
          result={installResult}
          serverUrl={getServerUrl()}
          enablingRouteSegment={enableMutation.isPending ? enableMutation.variables ?? null : null}
          onEnable={handleEnable}
          onUndo={() => installResult.source.id && undoMutation.mutate(installResult.source.id)}
          undoing={undoMutation.isPending}
          onDone={onDismiss}
        />
      )}

      {step === 'error' && (
        <PluginInstallErrorView
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
