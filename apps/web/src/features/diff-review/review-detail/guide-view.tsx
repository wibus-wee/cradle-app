import { Streamdown } from '@cradle/streamdown'
import {
  AlertLine as AlertCircleIcon,
  AnticlockwiseLine as RotateCcwIcon,
  ArrowLeftLine as ArrowLeftIcon,
  Clock2Line as Clock3Icon,
  CloseCircleLine as XCircleIcon,
  DownSmallLine as ChevronDownIcon,
  ExternalLinkLine as ExternalLinkIcon,
  GitCompareLine as FileDiffIcon,
  HeartbeatLine as ActivityIcon,
  RightSmallLine as ChevronRightIcon,
  SparklesLine as SparklesIcon,
  TreeLine as ListTreeIcon,
} from '@mingcute/react'
import type { CodeViewItem, FileDiffMetadata } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { CodeView } from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { getChatSessionsBySessionIdMessagesOptions } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import type { ChatSessionMessageRow } from '~/features/chat/session/use-chat-session-types'
import { ProviderModelSelector, RuntimeSelector, useComposerState } from '~/features/composer-toolbar'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import type { CodeViewLineSelection, DiffData, ThreadAnnotation } from '../shared/diff-items'
import {
  anchorToLineSelection,
  buildCodeViewOptions,
  buildItemsFromPatch,
  EMPTY_DIFF_DATA,
  formatAnchorRange,
  guideAnchorsForPath,
} from '../shared/diff-items'
import { useProviderBackedDiffRuntimeSelection } from '../shared/runtime-options'
import { navigateToReview, navigateToReviewAtAnchor } from '../shared/navigation'
import type { GenerateGuideInput, ReviewFile, ReviewGuideAnchor, ReviewGuideStep, ReviewThread } from '../shared/types'
import { useReview } from '../shared/use-review'

interface GuideViewProps {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
  onBack: () => void
}

export function GuideView({ workspaceId, repositoryPath, reviewId, onBack }: GuideViewProps) {
  const { review, isLoading, generateGuideMutation, cancelGuideMutation } = useReview({ workspaceId, repositoryPath, reviewId })
  const [regenerating, setRegenerating] = useState(false)
  // Snapshot of the last ready guide so the reader can keep reading the old walkthrough while a
  // regenerate runs. The server wipes steps to 'running' immediately on force, so without this the
  // reading view would blank out mid-regen. Updated whenever a fresh ready guide arrives.
  const previousGuideRef = useRef<NonNullable<ReturnType<typeof useReview>['review']>['guide'] | null>(null)

  const handleGenerate = (input: GenerateGuideInput) => {
    generateGuideMutation.mutate(input)
  }

  useEffect(() => {
    if (!review) {
      return
    }
    if (review.guide.status === 'ready' && review.guide.steps.length > 0) {
      previousGuideRef.current = review.guide
    }
    if (review.guide.status === 'ready') {
      setRegenerating(false)
    }
  }, [review])

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center" data-testid="guide-loading">
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (!review) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-muted-foreground">Review unavailable</p>
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
      </div>
    )
  }

  const guideFailed = review.guide.status === 'failed'
  const hasGuide = review.guide.status === 'ready' && review.guide.steps.length > 0
  const hasSnapshot = previousGuideRef.current != null
  // While regenerating with a snapshot, keep the old guide readable under a slim banner instead
  // of swapping to the full generation gate. Falls back to the gate if there's no snapshot yet
  // or if the regen failed.
  const showReadingFromSnapshot = regenerating && hasSnapshot && !guideFailed
  const showReading = (hasGuide && !regenerating) || showReadingFromSnapshot
  const showGate = !showReading
  const reviewForReading = showReadingFromSnapshot && previousGuideRef.current
    ? { ...review, guide: previousGuideRef.current }
    : review

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="guide-view">
      <header className="flex h-11 shrink-0 items-center gap-3 px-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-xs">
          <ArrowLeftIcon className="size-3.5" />
          Back to review
        </Button>
        <div className="h-4 w-px bg-border" />
        <ListTreeIcon className="size-3.5 !text-muted-foreground/60" aria-hidden />
        <h1 className="text-sm font-medium text-foreground">Guide</h1>
        {hasGuide && (
          <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            generated
          </span>
        )}
        {hasGuide && !regenerating && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5 text-xs text-muted-foreground"
            onClick={() => setRegenerating(true)}
            disabled={generateGuideMutation.isPending}
          >
            <RotateCcwIcon className="size-3.5" />
            Regenerate
          </Button>
        )}
      </header>

      {showGate
        ? (
            <GuideGenerateGate
              review={review}
              force={regenerating}
              pending={generateGuideMutation.isPending}
              cancelling={cancelGuideMutation.isPending}
              requestError={generateGuideMutation.error}
              onCancel={regenerating ? () => setRegenerating(false) : undefined}
              onCancelGeneration={() => cancelGuideMutation.mutate()}
              onGenerate={handleGenerate}
            />
          )
        : showReadingFromSnapshot
          ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <GuideRegenBanner
                  review={review}
                  cancelPending={cancelGuideMutation.isPending}
                  onCancel={() => cancelGuideMutation.mutate()}
                />
                <GuideReading review={reviewForReading} />
              </div>
            )
          : <GuideReading review={reviewForReading} />}
    </div>
  )
}

/**
 * Slim non-blocking banner shown above the still-readable previous guide while a regenerate runs.
 * Shows honest progress (streaming model output, on demand) and a Cancel affordance without
 * taking over the whole surface the way the first-generation gate does.
 */
function GuideRegenBanner({
  review,
  cancelPending,
  onCancel,
}: {
  review: NonNullable<ReturnType<typeof useReview>['review']>
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
          {showOutput ? 'Hide' : 'Show'} output
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

/**
 * The gate before any tokens are spent. Lets the user pick the tool runtime plus provider/model,
 * states the cost explicitly, and only fires generation on a deliberate click. In `force` mode it
 * replaces an existing guide rather than creating the first one.
 */
function GuideGenerateGate({
  review,
  force = false,
  pending,
  cancelling,
  onCancel,
  onCancelGeneration,
  onGenerate,
  requestError,
}: {
  review: NonNullable<ReturnType<typeof useReview>['review']>
  force?: boolean
  pending: boolean
  cancelling: boolean
  requestError: Error | null
  onCancel?: () => void
  onCancelGeneration: () => void
  onGenerate: (input: GenerateGuideInput) => void
}) {
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-lg px-6 py-12">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
            {force ? <RotateCcwIcon className="size-5" /> : <ListTreeIcon className="size-5" />}
          </span>
          <h2 className="mt-4 text-base font-semibold text-foreground">
            {force ? 'Regenerate the walkthrough' : 'Generate a change walkthrough'}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {force
              ? 'This re-runs the selected runtime and model over the current diff and replaces the existing guide chapter by chapter.'
              : 'A guide walks you through this change step by step — what each part does, why it exists, and where to look. We generate it on demand with the selected runtime and model.'}
          </p>
        </div>

        <div className="mt-8 space-y-4 rounded-xl border border-border bg-sidebar/40 p-4">
          <Field label="Tool runtime">
            <RuntimeSelector
              value={runtimeKind}
              onChange={composer.setRuntimeKind}
              options={guideRuntimeOptions}
              disabled={generationActive}
            />
          </Field>

          <Field label="Provider & model">
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
          </Field>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {force
              ? 'Regenerating runs the selected runtime and model over this review again and spends tokens.'
              : 'Generating a guide runs the selected runtime and model over this review and spends tokens.'}
            {review.currentRevision
              ? ` It covers ${review.currentRevision.fileCount} file${review.currentRevision.fileCount === 1 ? '' : 's'}.`
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
          />
        )}

        <div className="mt-5 flex items-center gap-2">
          {force && onCancel && (
            <Button
              type="button"
              size="lg"
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
            size="lg"
            className="flex-1"
            onClick={handleGenerate}
            disabled={!canGenerate || generationActive}
          >
            {generationActive ? <Spinner className="size-4" /> : (force ? <RotateCcwIcon className="size-4" /> : <SparklesIcon className="size-4" />)}
            {generationActive
              ? 'Generating guide'
              : review.guide.status === 'failed'
                ? 'Retry guide'
                : force ? 'Regenerate guide' : 'Generate guide'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function isGuideGenerationActive(status: NonNullable<ReturnType<typeof useReview>['review']>['guide']['status']): boolean {
  return status === 'pending' || status === 'running'
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest.toString().padStart(2, '0')}s` : `${rest}s`
}

/** Compact relative time for a unix-seconds timestamp, e.g. "just now", "5m ago", "2h ago". */
function formatRelativeTime(unixSeconds: number | null): string | null {
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

/** Understated model · generated-when · file-count line under the guide title. */
function ProvenanceLine({
  guide,
  fileCount,
}: {
  guide: NonNullable<ReturnType<typeof useReview>['review']>['guide']
  fileCount?: number
}) {
  const relativeTime = formatRelativeTime(guide.updatedAt)
  const parts: { key: string, node: React.ReactNode }[] = []
  if (guide.modelId) {
    parts.push({ key: 'model', node: <span className="font-mono">{guide.modelId}</span> })
  }
  if (relativeTime) {
    parts.push({ key: 'time', node: <span>generated {relativeTime}</span> })
  }
  if (fileCount != null) {
    parts.push({ key: 'files', node: <span>{fileCount} file{fileCount === 1 ? '' : 's'}</span> })
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

/**
 * Polls the guide session's messages and surfaces the streaming assistant output (text plus
 * reasoning) so the UI can show real progress. The server-side `extractMessageText` only collects
 * `text` parts, which leaves `row.content` empty while Claude (or any provider that streams
 * reasoning first) is still thinking — walking `row.message.parts` directly surfaces both, so the
 * reader sees tokens instead of "Waiting for the first assistant token".
 */
function useGuideStreamingOutput(sessionId: string | null, active: boolean) {
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

/** Streaming model-output block, shared by the generation gate panel and the non-blocking regen banner. */
function GuideStreamingOutput({
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

function GuideGenerationStatusPanel({
  guide,
  requestPending,
  cancelPending,
  requestError,
  onCancel,
}: {
  guide: NonNullable<ReturnType<typeof useReview>['review']>['guide']
  requestPending: boolean
  cancelPending: boolean
  requestError: Error | null
  onCancel: () => void
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
        'mt-4 rounded-lg px-3 py-3 text-[11px]',
        failed
          ? 'bg-red-500/10 text-red-700 dark:text-red-300'
          : cancelled
            ? 'bg-muted text-muted-foreground'
            : 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
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

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  )
}

function GuideReading({
  review,
}: {
  review: NonNullable<ReturnType<typeof useReview>['review']>
}) {
  const steps = review.guide.steps
  const guideTitle = review.guide.title
  const files = review.files
  const fileById = useMemo(() => new Map(files.map(file => [file.id, file])), [files])
  const pathToFile = useMemo(() => new Map(files.map(file => [file.path, file])), [files])
  const threadById = useMemo(() => new Map(review.threads.map(thread => [thread.id, thread])), [review.threads])

  const diffData: DiffData = useMemo(
    () => (review.currentRevision?.patch?.trim() ? buildItemsFromPatch(review.currentRevision.patch) : EMPTY_DIFF_DATA),
    [review.currentRevision?.patch],
  )

  // Jump from a guide anchor (or thread) into the review detail at that line. Drops the guide
  // view and lands on the file + line so the reader can see the full diff context.
  const handleOpenInReview = (path?: string, line?: number, side?: 'base' | 'head') => {
    if (path && line != null) {
      navigateToReviewAtAnchor(review.workspaceId, review.id, { repositoryPath: review.repositoryPath, path, line, side: side ?? 'head' })
    }
    else if (path) {
      navigateToReview(review.workspaceId, review.id, { repositoryPath: review.repositoryPath, path })
    }
    else {
      navigateToReview(review.workspaceId, review.id, { repositoryPath: review.repositoryPath })
    }
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [activeChapterId, setActiveChapterId] = useState<string | null>(steps[0]?.id ?? null)

  // Scrollspy: the topmost section entering the container's upper ~40% becomes the active chapter.
  // Re-runs when steps identity changes (e.g. after a regenerate swaps in a new chapter set).
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || steps.length === 0) {
      return
    }
    const sections = steps
      .map(step => document.getElementById(step.id))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          setActiveChapterId(visible[0].target.id)
        }
      },
      { root: container, rootMargin: '0px 0px -60% 0px', threshold: 0 },
    )
    for (const section of sections) {
      observer.observe(section)
    }
    return () => observer.disconnect()
  }, [steps])

  const handleJump = (chapterId: string) => {
    document.getElementById(chapterId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <GuideChapterRail
        steps={steps}
        activeChapterId={activeChapterId}
        onJump={handleJump}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GuideChapterScroller
          steps={steps}
          activeChapterId={activeChapterId}
          onJump={handleJump}
        />
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
          <article className="mx-auto max-w-6xl px-8 py-10 lg:px-12 lg:py-14">
            <header className="mb-12 border-b border-border/60 pb-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                Guided review
              </p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-foreground">
                {guideTitle ?? review.title}
              </h2>
              {!guideTitle && (
                <p className="mt-1 text-[11px] text-muted-foreground/50">
                  {review.title}
                </p>
              )}
              <p className="mt-2 text-[12px] tabular-nums text-muted-foreground">
                {steps.length}
                {' '}
                chapter
                {steps.length === 1 ? '' : 's'}
              </p>
              <ProvenanceLine guide={review.guide} fileCount={review.currentRevision?.fileCount} />
            </header>

            <div className="space-y-14">
              {steps.map((step, index) => (
                <GuideSection
                  key={step.id}
                  step={step}
                  index={index}
                  fileById={fileById}
                  pathToFile={pathToFile}
                  diffData={diffData}
                  preferences={review.preferences}
                  threadById={threadById}
                  onOpenInReview={handleOpenInReview}
                />
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}

/**
 * Persistent vertical chapter index, shown on `xl` and up where the viewport has room for a
 * dedicated rail. Tracks the active chapter via scrollspy and jumps on click.
 */
function GuideChapterRail({
  steps,
  activeChapterId,
  onJump,
}: {
  steps: ReviewGuideStep[]
  activeChapterId: string | null
  onJump: (chapterId: string) => void
}) {
  if (steps.length <= 1) {
    return null
  }
  return (
    <nav
      aria-label="Guide chapters"
      className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/40 px-3 py-8 xl:flex"
    >
      <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/50">
        Chapters
      </p>
      {steps.map((step, index) => {
        const active = step.id === activeChapterId
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onJump(step.id)}
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-snug transition-colors',
              active
                ? 'bg-muted/60 text-foreground'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            <span className={cn(
              'mt-px shrink-0 font-mono text-[10px] tabular-nums',
              active ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground/50',
            )}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="line-clamp-2">{step.title}</span>
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Compact horizontal chapter scroller for narrow viewports (below `xl`). Stays pinned above the
 * reading column so the active chapter is always reachable while scrolling.
 */
function GuideChapterScroller({
  steps,
  activeChapterId,
  onJump,
}: {
  steps: ReviewGuideStep[]
  activeChapterId: string | null
  onJump: (chapterId: string) => void
}) {
  if (steps.length <= 1) {
    return null
  }
  return (
    <div className="border-b border-border/40 bg-background/85 backdrop-blur xl:hidden">
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((step, index) => {
          const active = step.id === activeChapterId
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onJump(step.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="font-mono tabular-nums opacity-60">{String(index + 1).padStart(2, '0')}</span>
              <span className="max-w-32 truncate">{step.title}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One chapter rendered as a horizontal card: the narrative on the left, the chapter's file group on
 * the right. Each file in the group is a collapsed block by default and expands into its diff.
 */
function GuideSection({
  step,
  index,
  fileById,
  pathToFile,
  diffData,
  preferences,
  threadById,
  onOpenInReview,
}: {
  step: ReviewGuideStep
  index: number
  fileById: Map<string, ReviewFile>
  pathToFile: Map<string, ReviewFile>
  diffData: DiffData
  preferences: NonNullable<ReturnType<typeof useReview>['review']>['preferences']
  threadById: Map<string, ReviewThread>
  onOpenInReview: (path?: string, line?: number, side?: 'base' | 'head') => void
}) {
  // Resolve this chapter's files into CodeView items.
  const fileItems = useMemo(() => {
    const seen = new Set<string>()
    const items: CodeViewItem<ThreadAnnotation>[] = []
    for (const fileId of step.fileIds) {
      const file = fileById.get(fileId)
      if (!file) {
        continue
      }
      const itemId = diffData.pathToItemId.get(file.path)
      if (!itemId || seen.has(itemId)) {
        continue
      }
      seen.add(itemId)
      const base = diffData.items.find(i => i.id === itemId)
      if (base) {
        items.push(base)
      }
    }
    return items
  }, [step.fileIds, fileById, diffData])

  // Per-section expansion state, keyed by item id. Files render as lightweight collapsed blocks
  // by default; a CodeView is mounted only for a file the reader actually expands. This avoids
  // keeping one full CodeView instance (virtualizer, interaction manager, ResizeObserver, worker
  // highlighter, scroll listeners) alive per chapter on a long scrolling page.
  //
  // The primary anchored file auto-expands so the reader lands on the relevant code without an
  // extra click. GuideSection is keyed by step.id at the parent, so this initializer re-runs per
  // chapter.
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(() => {
    const primary = step.anchors[0]
    if (!primary) {
      return new Set()
    }
    const itemId = diffData.pathToItemId.get(primary.path)
    return itemId ? new Set([itemId]) : new Set()
  })

  const options = useMemo(
    () => buildCodeViewOptions('unified'),
    [],
  )

  const diffStyleVars = {
    '--diffs-font-size': `${preferences.fontSize ?? 12}px`,
    '--diffs-line-height': `${preferences.lineHeight ?? 18}px`,
  } as CSSProperties

  const toggleFile = (itemId: string) => {
    setExpandedFileIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      }
      else {
        next.add(itemId)
      }
      return next
    })
  }

  const hasFiles = step.fileIds.length > 0
  const hasThreads = step.threadIds.length > 0

  return (
    <section id={step.id} className="grid grid-cols-1 gap-8 scroll-mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Narrative */}
      <div className="relative pl-12">
        <span className="pointer-events-none absolute left-0 top-0 select-none font-mono text-2xl font-semibold leading-none text-muted-foreground/25 tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">
          {step.title}
        </h3>
        <Streamdown
          content={step.rationale}
          streaming={false}
          animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
          animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
          showCursor={false}
          className="mt-3 text-[14px] leading-[1.75] text-foreground/85"
        />

        {(hasFiles || hasThreads) && (
          <footer className="mt-4 border-t border-dashed border-border/70 pt-2.5">
            <ol className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              {hasFiles && (
                <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <FootnoteMark />
                  <span className="text-muted-foreground/70">Files touched:</span>
                  {step.fileIds.map((fileId) => {
                    const file = fileById.get(fileId)
                    return file
                      ? <span key={fileId} className="font-mono text-[10px] text-foreground/70">{file.path}</span>
                      : null
                  })}
                </li>
              )}
              {hasThreads && (
                <li className="flex flex-wrap items-center gap-1.5">
                  <FootnoteMark />
                  <span className="text-muted-foreground/70">Threads:</span>
                  {step.threadIds.map((threadId) => {
                    const thread = threadById.get(threadId)
                    if (!thread) {
                      return null
                    }
                    const commentCount = thread.comments.length
                    return (
                      <button
                        key={threadId}
                        type="button"
                        onClick={() => onOpenInReview(
                          thread.anchor?.path,
                          thread.anchor?.startLine,
                          thread.anchor?.side,
                        )}
                        className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={`Open in review · ${commentCount} comment${commentCount === 1 ? '' : 's'}`}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            thread.state === 'resolved'
                              ? 'bg-emerald-500'
                              : thread.state === 'stale'
                                ? 'bg-amber-500'
                                : 'bg-sky-500',
                          )}
                          aria-hidden
                        />
                        <span className="tabular-nums">{commentCount}</span>
                      </button>
                    )
                  })}
                </li>
              )}
            </ol>
          </footer>
        )}
      </div>

      {/* File group: collapsed blocks by default; a bounded CodeView mounts only for expanded files. */}
      <div className="min-h-0 max-h-128 overflow-y-auto [overflow-anchor:none] space-y-2">
        {fileItems.length === 0
          ? (
              <div className="flex h-full items-center justify-center p-4 text-center">
                <p className="text-xs text-muted-foreground">No code attached to this chapter.</p>
              </div>
            )
          : fileItems.map((item) => {
              if (item.type !== 'diff') {
                return null
              }
              const file = pathToFile.get(item.fileDiff.name) ?? null
              const fileAnchors = guideAnchorsForPath(step.anchors, item.fileDiff.name)
              const focusLabel = fileAnchors[0] ? formatAnchorRange(fileAnchors[0]) : null
              const expanded = expandedFileIds.has(item.id)
              return (
                <div key={item.id} className="rounded-lg border border-border/60">
                  <CollapsedFileBlock
                    fileDiff={item.fileDiff}
                    file={file}
                    focusLabel={focusLabel}
                    anchorCount={fileAnchors.length}
                    expanded={expanded}
                    onToggle={() => toggleFile(item.id)}
                  />
                  {expanded && (
                    <GuideFileCodeView
                      item={item}
                      anchors={step.anchors}
                      options={options}
                      diffStyleVars={diffStyleVars}
                      onOpenInReview={onOpenInReview}
                    />
                  )}
                </div>
              )
            })}
      </div>
    </section>
  )
}

/**
 * The expanded diff for one file in a chapter. Mounts a single-file CodeView and highlights the
 * chapter's active anchor range for this file as the controlled selection, centering it on mount.
 * When a chapter has multiple anchors in the same file, a pill switcher above the CodeView lets
 * the reader move between them — each pill re-sets the controlled selection and re-centers.
 */
function GuideFileCodeView({
  item,
  anchors,
  options,
  diffStyleVars,
  onOpenInReview,
}: {
  item: Extract<CodeViewItem<ThreadAnnotation>, { type: 'diff' }>
  anchors: ReviewGuideAnchor[]
  options: ReturnType<typeof buildCodeViewOptions>
  diffStyleVars: CSSProperties
  onOpenInReview: (path?: string, line?: number, side?: 'base' | 'head') => void
}) {
  const viewerRef = useRef<CodeViewHandle<ThreadAnnotation>>(null)
  const fileAnchors = useMemo(
    () => guideAnchorsForPath(anchors, item.fileDiff.name),
    [anchors, item.fileDiff.name],
  )
  const [activeAnchorIndex, setActiveAnchorIndex] = useState(0)
  const activeAnchor = fileAnchors[activeAnchorIndex] ?? fileAnchors[0] ?? null

  const selectedLines = useMemo<CodeViewLineSelection | null>(
    () => activeAnchor ? anchorToLineSelection(item.id, activeAnchor) : null,
    [activeAnchor, item.id],
  )

  // Center the active anchor range whenever it changes. Two rAFs on first mount let the freshly
  // mounted CodeView measure its virtual window before we ask it to scroll; subsequent pill
  // clicks reuse the same path and just re-center on the new range.
  useEffect(() => {
    if (!selectedLines) {
      return
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        viewerRef.current?.scrollTo({
          type: 'range',
          id: item.id,
          range: selectedLines.range,
          align: 'center',
          behavior: 'instant',
        })
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [item.id, selectedLines])

  return (
    <div className="flex flex-col">
      {fileAnchors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
          {fileAnchors.length > 1 && fileAnchors.map((anchor, index) => {
            const active = index === activeAnchorIndex
            return (
              <button
                key={`${anchor.side}-${anchor.startLine}-${anchor.endLine}`}
                type="button"
                onClick={() => setActiveAnchorIndex(index)}
                className={cn(
                  'rounded-full px-2 py-0.5 font-mono text-[10px] font-medium transition-colors',
                  active
                    ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {formatAnchorRange(anchor)}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => activeAnchor && onOpenInReview(item.fileDiff.name, activeAnchor.startLine, activeAnchor.side)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open this range in the review diff"
          >
            <ExternalLinkIcon className="size-3" />
            Open in review
          </button>
        </div>
      )}
      <CodeView
        ref={viewerRef}
        items={[{ ...item, collapsed: false }]}
        options={options}
        selectedLines={selectedLines}
        style={diffStyleVars}
        className="max-h-[28rem] overflow-auto [overflow-anchor:none]"
      />
    </div>
  )
}

/** Compact collapsed file block: icon · path · focus range · +N more anchors · +/− diff changes · change type. Expands on click. */
function CollapsedFileBlock({
  fileDiff,
  file,
  focusLabel,
  anchorCount,
  expanded,
  onToggle,
}: {
  fileDiff: FileDiffMetadata
  file: ReviewFile | null
  focusLabel: string | null
  anchorCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const additions = file?.additions ?? 0
  const deletions = file?.deletions ?? 0
  const changeLabel = changeTypeLabel(fileDiff.type)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onToggle}
      className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left font-normal hover:bg-muted/40"
    >
      {expanded
        ? <ChevronDownIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />
        : <ChevronRightIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />}
      <FileDiffIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
        {fileDiff.name}
      </span>
      {focusLabel && (
        <span className="shrink-0 rounded bg-orange-500/12 px-1.5 py-0.5 font-mono text-[9px] font-medium text-orange-600 dark:text-orange-400">
          {focusLabel}
        </span>
      )}
      {focusLabel && anchorCount > 1 && (
        <span className="shrink-0 rounded bg-orange-500/8 px-1.5 py-0.5 font-mono text-[9px] font-medium text-orange-600/80 dark:text-orange-400/80">
          +{anchorCount - 1}
        </span>
      )}
      {changeLabel && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          {changeLabel}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">
+
{additions}
        </span>
        <span className="text-red-600 dark:text-red-400">
−
{deletions}
        </span>
      </span>
    </Button>
  )
}

function changeTypeLabel(type: FileDiffMetadata['type']): string | null {
  switch (type) {
    case 'new':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'rename-pure':
    case 'rename-changed':
      return 'renamed'
    case 'change':
      return null
    default:
      return null
  }
}

function FootnoteMark() {
  return (
    <span className="font-mono text-[9px] text-muted-foreground/50" aria-hidden>
      ※
    </span>
  )
}
