import { Streamdown } from '@cradle/streamdown'
import {
  AlertLine as AlertCircleIcon,
  AnticlockwiseLine as RotateCcwIcon,
  Clock2Line as Clock3Icon,
  CloseCircleLine as XCircleIcon,
  HeartbeatLine as ActivityIcon,
  SparklesLine as SparklesIcon,
  TreeLine as ListTreeIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getChatSessionsBySessionIdMessagesOptions } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import type { ChatSessionMessageRow } from '~/features/chat/session/use-chat-session-types'
import { ProviderModelSelector, RuntimeSelector, useComposerState } from '~/features/composer-toolbar'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { isGuideGenerationActive } from '../shared/guide-insights'
import { useProviderBackedDiffRuntimeSelection } from '../shared/runtime-options'
import type { CradleDiffReview, GenerateGuideInput } from '../shared/types'

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest.toString().padStart(2, '0')}s` : `${rest}s`
}

export function formatRelativeTime(unixSeconds: number | null): string | null {
  if (unixSeconds == null) {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  const diff = Math.max(0, now - unixSeconds)
  if (diff < 60) {
    return 'just now'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`
  }
  if (diff < 604800) {
    return `${Math.floor(diff / 86400)}d ago`
  }
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

export function ProvenanceLine({
  guide,
  fileCount,
}: {
  guide: CradleDiffReview['guide']
  fileCount?: number
}) {
  const relativeTime = formatRelativeTime(guide.updatedAt)
  const parts: { key: string, node: React.ReactNode }[] = []
  if (guide.modelId) {
    parts.push({ key: 'model', node: <span className="font-mono">{guide.modelId}</span> })
  }
  if (relativeTime) {
    parts.push({
      key: 'time',
      node: (
        <span>
          generated
          {' '}
          {relativeTime}
        </span>
      ),
    })
  }
  if (fileCount != null) {
    parts.push({
      key: 'files',
      node: (
        <span>
          {fileCount}
          {' '}
          file
          {fileCount === 1 ? '' : 's'}
        </span>
      ),
    })
  }
  if (parts.length === 0) {
    return null
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/60">
      {parts.map((part, index) => (
        <span key={part.key} className="inline-flex items-center gap-1.5">
          {index > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
          {part.node}
        </span>
      ))}
    </p>
  )
}

export function useGuideStreamingOutput(sessionId: string | null, active: boolean) {
  const sessionMessagesOptions = useMemo(
    () => getChatSessionsBySessionIdMessagesOptions({ path: { sessionId: sessionId ?? '' } }),
    [sessionId],
  )
  const messagesQuery = useQuery<
    unknown,
    Error,
    ChatSessionMessageRow[],
    ReturnType<typeof getChatSessionsBySessionIdMessagesOptions>['queryKey']
  >({
    queryKey: sessionMessagesOptions.queryKey,
    queryFn: sessionMessagesOptions.queryFn,
    enabled: Boolean(sessionId),
    select: data => data as ChatSessionMessageRow[],
    refetchInterval: active ? 1_500 : false,
  })
  return useMemo(() => {
    const row = [...(messagesQuery.data ?? [])]
      .reverse()
      .find(message => message.role === 'assistant' && !message.parentToolCallId)
    if (!row) {
      return null
    }
    const parts = row.message?.parts ?? []
    let combined = ''
    for (const part of parts) {
      if (part.type === 'text') {
        combined += part.text
      }
      else if (part.type === 'reasoning') {
        const reasoningText = (part as { text?: string }).text
        if (reasoningText) {
          combined += reasoningText
        }
      }
    }
    return combined.trim() || null
  }, [messagesQuery.data])
}

export function GuideStreamingOutput({
  output,
  active,
  modelId,
}: {
  output: string | null
  active: boolean
  modelId: string | null
}) {
  if (!output) {
    return null
  }
  return (
    <div className="overflow-hidden rounded-md border border-current/15 bg-background/80">
      <div className="flex items-center justify-between border-b border-current/10 px-2.5 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-normal text-current/60">
          Model output
        </span>
        {modelId && (
          <span className="max-w-48 truncate text-[10px] text-current/50">
            {modelId}
          </span>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto px-2.5 py-2 text-[11px] leading-relaxed text-foreground">
        <Streamdown
          content={output}
          streaming={active}
          animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
          animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
          showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
        />
      </div>
    </div>
  )
}

export function GuideGenerationStatusPanel({
  guide,
  requestPending,
  cancelPending,
  requestError,
  onCancel,
  className,
}: {
  guide: CradleDiffReview['guide']
  requestPending: boolean
  cancelPending: boolean
  requestError: Error | null
  onCancel: () => void
  className?: string
}) {
  const active = requestPending || isGuideGenerationActive(guide.status)
  const now = useNow(1_000, active)
  const startedAtMs = guide.createdAt ? guide.createdAt * 1_000 : now
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1_000))
  const errorText = requestError?.message ?? guide.errorMessage
  const failed = Boolean(errorText) || guide.status === 'failed'
  const cancelled = guide.status === 'cancelled'
  const assistantOutput = useGuideStreamingOutput(guide.sessionId, active)

  const statusLabel = failed
    ? 'Generation failed'
    : cancelled
      ? 'Generation cancelled'
      : requestPending
        ? 'Starting generation'
        : 'Reading diff and writing guide'
  const statusDetail = failed
    ? 'The backend saved the failure so you can adjust the model or retry.'
    : cancelled
      ? 'The runtime turn was stopped and any late guide artifact will be ignored.'
      : requestPending
        ? 'Cradle is checking the diff revision and provider before starting the runtime turn.'
        : 'The runtime turn is reading changed files with tools and producing the guide artifact in the background.'

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-3 text-[11px]',
        failed
          ? 'bg-red-500/10 text-red-700 dark:text-red-300'
          : cancelled
            ? 'bg-muted text-muted-foreground'
            : 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {failed
          ? <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          : cancelled
            ? <XCircleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            : active
              ? <ActivityIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              : <Clock3Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{statusLabel}</p>
            {active && (
              <span className="shrink-0 tabular-nums text-current/70">
                {formatElapsed(elapsedSeconds)}
              </span>
            )}
          </div>
          <p className="mt-1 leading-relaxed text-current/80">{statusDetail}</p>
          {errorText && (
            <p className="mt-2 break-words rounded-md bg-background/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-current/90">
              {errorText}
            </p>
          )}
          {active && (
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={onCancel}
                disabled={cancelPending}
              >
                {cancelPending ? <Spinner className="size-3" /> : <XCircleIcon className="size-3" />}
                Cancel generation
              </Button>
            </div>
          )}
          <div className="mt-3">
            <GuideStreamingOutput output={assistantOutput} active={active} modelId={guide.modelId} />
          </div>
          {!assistantOutput && guide.sessionId && (
            <p className="mt-3 rounded-md border border-current/15 bg-background/70 px-2.5 py-2 text-[10px] leading-relaxed text-current/65">
              Waiting for the first assistant token from this runtime turn.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function GuideField({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  )
}

export function GuideGenerateGate({
  review,
  force = false,
  layout = 'page',
  pending,
  cancelling,
  onCancel,
  onCancelGeneration,
  onGenerate,
  requestError,
}: {
  review: CradleDiffReview
  force?: boolean
  layout?: 'page' | 'rail'
  pending: boolean
  cancelling: boolean
  requestError: Error | null
  onCancel?: () => void
  onCancelGeneration: () => void
  onGenerate: (input: GenerateGuideInput) => void
}) {
  const { t } = useTranslation('diff-review')
  const composer = useComposerState({ context: 'new-chat' })
  const runtimeKind = composer.selection.runtimeKind
  const profileId = composer.selection.profileId
  const modelId = composer.selection.modelId
  const {
    runtimeKindSet: guideRuntimeKinds,
    runtimeOptions: guideRuntimeOptions,
  } = useProviderBackedDiffRuntimeSelection(composer.runtimeOptions)

  const canGenerate = profileId != null && guideRuntimeKinds.has(runtimeKind)
  const generationActive = pending || isGuideGenerationActive(review.guide.status)

  const handleGenerate = () => {
    if (!profileId || !canGenerate || generationActive) {
      return
    }
    onGenerate({
      providerTargetId: profileId,
      runtimeKind,
      modelId: modelId ?? null,
      force,
    })
  }

  const isRail = layout === 'rail'

  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto', isRail ? 'bg-transparent' : 'bg-background')}>
      <div className={cn(isRail ? 'px-3 py-4' : 'mx-auto max-w-lg px-6 py-12')}>
        <div className={cn('flex flex-col', isRail ? 'items-start text-left' : 'items-center text-center')}>
          <span className="flex size-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
            {force ? <RotateCcwIcon className="size-4" /> : <ListTreeIcon className="size-4" />}
          </span>
          <h2 className={cn('font-semibold text-foreground', isRail ? 'mt-3 text-[13px]' : 'mt-4 text-base')}>
            {force ? t('guide.generate.regenerateTitle') : t('guide.generate.title')}
          </h2>
          <p className={cn('leading-relaxed text-muted-foreground', isRail ? 'mt-1 text-[11px]' : 'mt-1.5 text-[13px]')}>
            {force ? t('guide.generate.regenerateDescription') : t('guide.generate.description')}
          </p>
        </div>

        <div className={cn('space-y-3 rounded-xl border border-border bg-sidebar/40 p-3', isRail ? 'mt-4' : 'mt-8 space-y-4 p-4')}>
          <GuideField label={t('guide.generate.runtimeLabel')}>
            <RuntimeSelector
              value={runtimeKind}
              onChange={composer.setRuntimeKind}
              options={guideRuntimeOptions}
              disabled={generationActive}
            />
          </GuideField>

          <GuideField label={t('guide.generate.modelLabel')}>
            <ProviderModelSelector
              profiles={composer.profiles}
              selectedProfileId={profileId}
              selectedModelId={modelId}
              models={composer.models}
              modelsByProfileId={composer.modelsByProfileId}
              loadingProfileIds={composer.loadingProfileIds}
              thinkingEffort={composer.selection.thinkingEffort}
              isLoadingModels={composer.isLoadingModels}
              requestProfileModels={composer.requestProfileModels}
              onSelectProfile={composer.setProfileId}
              onSelectModel={composer.setModelId}
              onSelectThinkingEffort={composer.setThinkingEffort}
            />
          </GuideField>
        </div>

        <div className={cn(
          'flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300',
          isRail ? 'mt-3' : 'mt-4',
        )}
        >
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {force ? t('guide.generate.regenerateCost') : t('guide.generate.cost')}
            {review.currentRevision
              ? ` ${t('guide.generate.fileCount', { count: review.currentRevision.fileCount })}`
              : ''}
          </span>
        </div>

        {(generationActive || review.guide.status === 'failed' || requestError) && (
          <GuideGenerationStatusPanel
            guide={review.guide}
            requestPending={pending}
            cancelPending={cancelling}
            requestError={requestError}
            onCancel={onCancelGeneration}
            className={isRail ? 'mt-3' : 'mt-4'}
          />
        )}

        <div className={cn('flex items-center gap-2', isRail ? 'mt-3' : 'mt-5')}>
          {force && onCancel && (
            <Button
              type="button"
              size={isRail ? 'sm' : 'lg'}
              variant="outline"
              className="flex-1"
              onClick={onCancel}
              disabled={generationActive}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size={isRail ? 'sm' : 'lg'}
            className="flex-1"
            onClick={handleGenerate}
            disabled={!canGenerate || generationActive}
          >
            {generationActive ? <Spinner className="size-4" /> : (force ? <RotateCcwIcon className="size-4" /> : <SparklesIcon className="size-4" />)}
            {generationActive
              ? t('guide.generate.generating')
              : review.guide.status === 'failed'
                ? t('guide.generate.retry')
                : force ? t('guide.generate.regenerateAction') : t('guide.generate.action')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function GuideRegenBanner({
  review,
  cancelPending,
  onCancel,
}: {
  review: CradleDiffReview
  cancelPending: boolean
  onCancel: () => void
}) {
  const guide = review.guide
  const active = isGuideGenerationActive(guide.status)
  const assistantOutput = useGuideStreamingOutput(guide.sessionId, active)
  const [showOutput, setShowOutput] = useState(false)
  const now = useNow(1_000, active)
  const startedAtMs = guide.createdAt ? guide.createdAt * 1_000 : now
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1_000))

  return (
    <div className="shrink-0 border-b border-orange-500/20 bg-orange-500/8">
      <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-orange-700 dark:text-orange-300">
        <Spinner className="size-3.5" aria-hidden />
        <span className="font-medium">Regenerating walkthrough</span>
        <span className="shrink-0 tabular-nums text-current/70">{formatElapsed(elapsedSeconds)}</span>
        <button
          type="button"
          onClick={() => setShowOutput(value => !value)}
          className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-current/70 transition-colors hover:bg-orange-500/10"
        >
          {showOutput ? 'Hide' : 'Show'}
          {' '}
          output
        </button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1.5 px-2 text-[11px]"
          onClick={onCancel}
          disabled={cancelPending}
        >
          {cancelPending ? <Spinner className="size-3" /> : <XCircleIcon className="size-3" />}
          Cancel
        </Button>
      </div>
      {showOutput && (
        <div className="px-4 pb-3">
          <GuideStreamingOutput output={assistantOutput} active={active} modelId={guide.modelId} />
          {!assistantOutput && guide.sessionId && (
            <p className="mt-2 rounded-md border border-current/15 bg-background/70 px-2.5 py-2 text-[10px] leading-relaxed text-current/65">
              Waiting for the first assistant token from this runtime turn.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
