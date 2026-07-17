import {
  AnticlockwiseLine as RotateCcwIcon,
  ArrowLeftLine as ArrowLeftIcon,
  CheckCircleLine as CheckCircle2Icon,
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  CopyLine as CopyIcon,
  DownSmallLine as ChevronDownIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as FileDiffIcon,
  PencilLine as PencilIcon,
  RightSmallLine as ChevronRightIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { toastManager } from '~/components/ui/toast'
import { ProviderModelSelector, RuntimeSelector, useComposerState } from '~/features/composer-toolbar'
import { cn } from '~/lib/cn'

import { navigateToReview } from './shared/navigation'
import { useProviderBackedDiffRuntimeSelection } from './shared/runtime-options'
import type {
  CradleDiffReview,
  EditableCommitPlanStatus,
  ReviewAgentFix,
  ReviewCommitPlan,
  ReviewCommitPlanGroup,
  ReviewFile,
} from './shared/types'
import { useReview } from './shared/use-review'

interface CommitPlanPageProps {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
}

interface StatusBadge {
  label: string
  className: string
}

const STATUS_BADGE: Record<ReviewCommitPlan['status'], StatusBadge> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  accepted: { label: 'Approved', className: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
  applied: { label: 'Applied', className: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  abandoned: { label: 'Abandoned', className: 'bg-muted text-muted-foreground/70' },
}

const PLAN_INSTRUCTION = 'Plan a clean commit sequence for this review. Propose commit messages, file groupings, dependencies, and whether the working tree is ready to commit.'

export function CommitPlanPage({ workspaceId, repositoryPath, reviewId }: CommitPlanPageProps) {
  const {
    review,
    isLoading,
    commitPlanUpdateMutation,
    commitPlanApplyMutation,
    createAgentFixMutation,
    startAgentFixMutation,
  } = useReview({ workspaceId, repositoryPath, reviewId })

  const plan = review?.commitPlans[0] ?? null
  const latestCommitPlanningFix = latestCommitAgentFix(review)
  const commitPlanningActive = latestCommitPlanningFix?.status === 'pending' || latestCommitPlanningFix?.status === 'running'
  const commitPlanningBusy = createAgentFixMutation.isPending || startAgentFixMutation.isPending || commitPlanningActive
  const showPlanningStatus = plan?.status !== 'applied'
    && Boolean(latestCommitPlanningFix)
    && (commitPlanningActive || latestCommitPlanningFix?.status === 'failed')

  const handlePlanInChat = async (profileId: string | null, runtimeKind: string, modelId: string | null) => {
    if (!review || !profileId || runtimeKind.trim().length === 0) {
      return
    }
    const beforeIds = new Set(review.agentFixes.map(fix => fix.id))
    const createdReview = await createAgentFixMutation.mutateAsync({
      instruction: PLAN_INSTRUCTION,
      expectedOutput: 'commit',
    })
    const created = latestAgentFix(createdReview, beforeIds)
    if (!created) {
      return
    }
    await startAgentFixMutation.mutateAsync({
      agentFixId: created.id,
      providerTargetId: profileId,
      runtimeKind,
      modelId,
    })
  }

  const setStatus = (status: EditableCommitPlanStatus) => {
    if (!plan) {
      return
    }
    commitPlanUpdateMutation.mutate({
      planId: plan.id,
      groups: plan.groups,
      rationale: plan.rationale,
      status,
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (!review) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-muted-foreground">Review unavailable</p>
      </div>
    )
  }

  const back = () => navigateToReview(workspaceId, reviewId, { repositoryPath })

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="commit-plan-page">
      <header className="flex h-11 shrink-0 items-center gap-3 px-4">
        <Button variant="ghost" size="sm" onClick={back} className="gap-1.5 text-xs">
          <ArrowLeftIcon className="size-3.5" />
          Back to review
        </Button>
        <div className="h-4 w-px bg-border" />
        <GitCommitIcon className="size-3.5 !text-muted-foreground/60" aria-hidden />
        <h1 className="text-sm font-medium text-foreground">Commit plan</h1>
        {plan && (
          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_BADGE[plan.status].className)}>
            {STATUS_BADGE[plan.status].label}
          </span>
        )}
        {plan && (
          <PlanInChatButton
            busy={commitPlanningBusy}
            filesCount={review.files.length}
            fileCount={review.currentRevision?.fileCount ?? review.files.length}
            onPlan={handlePlanInChat}
            className="ml-auto"
          />
        )}
      </header>

      {showPlanningStatus && latestCommitPlanningFix && (
        <div className="shrink-0 px-4 pb-2">
          <CommitPlanningStatusPanel fix={latestCommitPlanningFix} />
        </div>
      )}

      {plan
        ? (
            <PlanReading
              review={review}
              plan={plan}
              updating={commitPlanUpdateMutation.isPending}
              applying={commitPlanApplyMutation.isPending}
              onUpdate={commitPlanUpdateMutation.mutate}
              onApply={() => commitPlanApplyMutation.mutate(plan.id)}
              onSetStatus={setStatus}
              onBack={back}
            />
          )
        : (
            <PlanGenerateGate
              review={review}
              busy={commitPlanningBusy}
              onPlan={handlePlanInChat}
            />
          )}
    </div>
  )
}

// ─── Reading / authoring view ───────────────────────────────────────────────

function PlanReading({
  review,
  plan,
  updating,
  applying,
  onUpdate,
  onApply,
  onSetStatus,
  onBack,
}: {
  review: CradleDiffReview
  plan: ReviewCommitPlan
  updating: boolean
  applying: boolean
  onUpdate: (input: {
    planId: string
    groups: ReviewCommitPlanGroup[]
    rationale: string
    status: EditableCommitPlanStatus
  }) => void
  onApply: () => void
  onSetStatus: (status: EditableCommitPlanStatus) => void
  onBack: () => void
}) {
  const files = review.files
  const fileById = useMemo(() => new Map(files.map(file => [file.id, file])), [files])
  const conflictFileIds = useMemo(() => new Set(plan.conflicts?.map(c => c.fileId) ?? []), [plan.conflicts])

  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const group of plan.groups) {
      for (const fileId of group.fileIds) {
        const file = fileById.get(fileId)
        if (file) {
          additions += file.additions
          deletions += file.deletions
        }
      }
    }
    return { additions, deletions }
  }, [plan.groups, fileById])

  const editable = plan.status !== 'applied'
  // Editing only renders while `editable`, so status is guaranteed editable here.
  const status = (plan.status === 'applied' ? 'accepted' : plan.status) as EditableCommitPlanStatus
  const fileCount = review.currentRevision?.fileCount ?? files.length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <article className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
        {/* Summary header */}
        <header className="mb-10 border-b border-border/60 pb-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
            Commit plan
          </p>
          <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-foreground">
            {review.title}
          </h2>
          <p className="mt-2 text-[12px] tabular-nums text-muted-foreground">
            {plan.groups.length}
            {' '}
            commit
{plan.groups.length === 1 ? '' : 's'}
            {' · '}
            {fileCount}
            {' '}
            file
{fileCount === 1 ? '' : 's'}
            {' · '}
            <span className="text-emerald-600 dark:text-emerald-400">
+
{totals.additions}
            </span>
            {' '}
            <span className="text-red-600 dark:text-red-400">
−
{totals.deletions}
            </span>
            {plan.conflicts && plan.conflicts.length > 0 && (
              <>
                {' · '}
                <span className="text-amber-600 dark:text-amber-400">
{plan.conflicts.length}
{' '}
shared
                </span>
              </>
            )}
          </p>
          <RationaleBlock
            value={plan.rationale}
            editable={editable}
            updating={updating}
            onSave={rationale => onUpdate({ planId: plan.id, groups: plan.groups, rationale, status })}
          />
        </header>

        {/* Conflicts notice */}
        {plan.conflicts && plan.conflicts.length > 0 && (
          <ConflictsNotice conflicts={plan.conflicts} groups={plan.groups} />
        )}

        {/* Commits — git-graph rail (dot per commit, line between) */}
        <ol className="space-y-3">
          {plan.groups.map((group, index) => (
            <li key={group.id} className="flex gap-3">
              <div className="relative flex w-5 shrink-0 justify-center">
                {index < plan.groups.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-4 h-[calc(100%+0.75rem)] w-px -translate-x-1/2 bg-border"
                  />
                )}
                <span className="relative z-10 mt-4 size-2.5 rounded-full bg-foreground/70 ring-4 ring-background" />
              </div>
              <CommitCard
                group={group}
                index={index}
                fileById={fileById}
                conflictFileIds={conflictFileIds}
                editable={editable}
                updating={updating}
                onMessageChange={(message) => {
                  const groups = plan.groups.map(g => (g.id === group.id ? { ...g, message } : g))
                  onUpdate({ planId: plan.id, groups, rationale: plan.rationale, status })
                }}
                className="min-w-0 flex-1"
              />
            </li>
          ))}
        </ol>

        {/* Action bar */}
        <CommitActionBar
          status={plan.status}
          groupCount={plan.groups.length}
          applying={applying}
          onApply={onApply}
          onApprove={() => onSetStatus('accepted')}
          onAbandon={() => onSetStatus('abandoned')}
          onReopen={() => onSetStatus('draft')}
          onBack={onBack}
        />
      </article>
    </div>
  )
}

function RationaleBlock({
  value,
  editable,
  updating,
  onSave,
}: {
  value: string
  editable: boolean
  updating: boolean
  onSave: (value: string) => void
}) {
  const { t } = useTranslation('diff-review')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  if (editing) {
    return (
      <div className="mt-4">
        <Textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Why these commits?"
          autoFocus
          className="min-h-16 resize-none text-[13px] leading-relaxed"
        />
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            className="text-xs"
            disabled={updating}
            onClick={() => { onSave(draft.trim() || value); setEditing(false) }}
          >
            {updating ? <Spinner className="size-3.5" /> : <CheckIcon className="size-3.5" />}
            Save
          </Button>
          <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => { setDraft(value); setEditing(false) }}>
            <XIcon className="size-3.5" />
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group mt-4 flex items-start gap-2">
      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-foreground/80">
        {value || <span className="italic text-muted-foreground/60">{t('plan.rationale.empty')}</span>}
      </p>
      {editable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => setEditing(true)}
          title="Edit rationale"
        >
          <PencilIcon className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

function ConflictsNotice({
  conflicts,
  groups,
}: {
  conflicts: NonNullable<ReviewCommitPlan['conflicts']>
  groups: ReviewCommitPlanGroup[]
}) {
  const { t } = useTranslation('diff-review')
  const [open, setOpen] = useState(false)
  const groupIndexById = useMemo(() => new Map(groups.map((g, i) => [g.id, i + 1])), [groups])
  return (
    <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(value => !value)}
        className="h-auto w-full justify-start gap-2 px-0 py-0 text-left text-[12px] text-amber-700 hover:bg-transparent dark:text-amber-400"
      >
        {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        <span>
{conflicts.length}
{' '}
file
{conflicts.length === 1 ? '' : 's'}
{' '}
appear in more than one commit
        </span>
        <span className="text-[11px] font-normal text-amber-600/80 dark:text-amber-400/80">
          {t('plan.conflicts.hint')}
        </span>
      </Button>
      {open && (
        <div className="mt-2 space-y-1 border-t border-amber-500/20 pt-2">
          {conflicts.map(conflict => (
            <div key={conflict.fileId} className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono text-amber-700 dark:text-amber-300">{conflict.path}</span>
              <span className="text-amber-600/60 dark:text-amber-400/60">→</span>
              <span className="text-amber-600/80 dark:text-amber-400/80">
                commit
{' '}
{conflict.groupIds.map(id => groupIndexById.get(id)).filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CommitCard({
  group,
  index,
  fileById,
  conflictFileIds,
  editable,
  updating,
  onMessageChange,
  className,
}: {
  group: ReviewCommitPlanGroup
  index: number
  fileById: Map<string, ReviewFile>
  conflictFileIds: Set<string>
  editable: boolean
  updating: boolean
  onMessageChange: (message: string) => void
  className?: string
}) {
  const [editingMessage, setEditingMessage] = useState(false)
  const [draftMessage, setDraftMessage] = useState(group.message)

  useEffect(() => { setDraftMessage(group.message) }, [group.message])

  const stats = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const fileId of group.fileIds) {
      const file = fileById.get(fileId)
      if (file) {
        additions += file.additions
        deletions += file.deletions
      }
    }
    return { additions, deletions }
  }, [group.fileIds, fileById])

  const dependsOnIndexes = group.dependsOn
    .map(dep => Number.parseInt(dep, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n <= index + 1 && n !== index + 1)

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(group.message)
      toastManager.add({ type: 'info', title: 'Commit message copied' })
    }
    catch {
      toastManager.add({ type: 'error', title: 'Could not copy message' })
    }
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-foreground">
          {group.title}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          #
{index + 1}
        </span>
      </div>

        {/* Commit message */}
        <div className="group mt-3">
          {editingMessage
            ? (
                <div>
                  <Textarea
                    value={draftMessage}
                    onChange={event => setDraftMessage(event.target.value)}
                    autoFocus
                    className="min-h-20 resize-none font-mono text-[12px] leading-relaxed"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="xs"
                      className="text-xs"
                      disabled={updating}
                      onClick={() => { onMessageChange(draftMessage.trim() || group.message); setEditingMessage(false) }}
                    >
                      {updating ? <Spinner className="size-3" /> : <CheckIcon className="size-3" />}
                      Save
                    </Button>
                    <Button type="button" variant="outline" size="xs" className="text-xs" onClick={() => { setDraftMessage(group.message); setEditingMessage(false) }}>
                      <XIcon className="size-3" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )
            : (
                <div className="relative rounded-lg bg-muted/50 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/90">
                    {group.message}
                  </pre>
                  <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="bg-background/80"
                      onClick={copyMessage}
                      title="Copy commit message"
                    >
                      <CopyIcon className="size-3" />
                    </Button>
                    {editable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="bg-background/80"
                        onClick={() => setEditingMessage(true)}
                        title="Edit commit message"
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
        </div>

        {/* Rationale */}
        {group.rationale && (
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">{group.rationale}</p>
        )}

        {/* Footer: stats + dependencies */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-2.5 text-[11px]">
          <span className="flex items-center gap-1.5 font-mono tabular-nums">
            <FileDiffIcon className="size-3 !text-muted-foreground/60" />
            <span className="text-emerald-600 dark:text-emerald-400">
+
{stats.additions}
            </span>
            <span className="text-red-600 dark:text-red-400">
−
{stats.deletions}
            </span>
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">
            {group.fileIds.length}
            {' '}
            file
{group.fileIds.length === 1 ? '' : 's'}
          </span>
          {dependsOnIndexes.length > 0 && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-muted-foreground">
                after commit
{' '}
{dependsOnIndexes.join(' · ')}
              </span>
            </>
          )}
        </div>

        {/* File chips */}
        <div className="mt-2.5 flex flex-wrap gap-1">
          {group.fileIds.map((fileId) => {
            const file = fileById.get(fileId)
            return (
              <span
                key={fileId}
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px]',
                  conflictFileIds.has(fileId)
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                    : 'bg-muted/60 text-muted-foreground',
                )}
              >
                {file?.path ?? fileId}
              </span>
            )
          })}
        </div>
    </div>
  )
}

function CommitActionBar({
  status,
  groupCount,
  applying,
  onApply,
  onApprove,
  onAbandon,
  onReopen,
  onBack,
}: {
  status: ReviewCommitPlan['status']
  groupCount: number
  applying: boolean
  onApply: () => void
  onApprove: () => void
  onAbandon: () => void
  onReopen: () => void
  onBack: () => void
}) {
  const { t } = useTranslation('diff-review')
  if (status === 'applied') {
    return (
      <div className="mt-8 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2Icon className="size-4" />
        <span className="text-[13px] font-medium">
          {t('plan.appliedBanner', { count: groupCount })}
        </span>
        <Button type="button" variant="outline" size="sm" className="ml-auto text-xs" onClick={onBack}>
          Back to review
        </Button>
      </div>
    )
  }

  if (status === 'accepted') {
    return (
      <div className="mt-8 flex items-center gap-2">
        <Button
          type="button"
          size="lg"
          className="flex-1"
          onClick={onApply}
          disabled={applying}
        >
          {applying ? <Spinner className="size-4" /> : <GitCommitIcon className="size-4" />}
          {applying ? 'Applying…' : `Apply ${groupCount} commit${groupCount === 1 ? '' : 's'}`}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onReopen}>
          Back to draft
        </Button>
      </div>
    )
  }

  if (status === 'abandoned') {
    return (
      <div className="mt-8 flex items-center gap-2">
        <Button type="button" size="lg" className="flex-1" onClick={onReopen}>
          Reopen plan
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          Back to review
        </Button>
      </div>
    )
  }

  // draft
  return (
    <div className="mt-8 flex items-center gap-2">
      <Button type="button" size="lg" className="flex-1" onClick={onApprove}>
        <CheckIcon className="size-4" />
        Approve plan
      </Button>
      <Button type="button" variant="outline" size="lg" onClick={onAbandon}>
        Abandon
      </Button>
    </div>
  )
}

// ─── Generate gate (no plan yet) ────────────────────────────────────────────

function PlanGenerateGate({
  review,
  busy,
  onPlan,
}: {
  review: CradleDiffReview
  busy: boolean
  onPlan: (profileId: string | null, runtimeKind: string, modelId: string | null) => Promise<void> | void
}) {
  const { t } = useTranslation('diff-review')
  const composer = useComposerState({ context: 'new-chat' })
  const runtimeKind = composer.selection.runtimeKind
  const profileId = composer.selection.profileId
  const modelId = composer.selection.modelId
  const { runtimeKindSet } = useProviderBackedDiffRuntimeSelection(composer.runtimeOptions)

  const canPlan = profileId != null && runtimeKindSet.has(runtimeKind)
  const fileCount = review.currentRevision?.fileCount ?? review.files.length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-lg px-6 py-12">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
            <GitCommitIcon className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold text-foreground">Plan your commits</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {t('plan.intro')}
          </p>
        </div>

        <PlanConfigCard composer={composer} busy={busy} className="mt-8" />

        <PlanCostNote fileCount={fileCount} />

        <Button
          type="button"
          size="lg"
          className="mt-5 w-full"
          onClick={() => onPlan(profileId, runtimeKind, modelId)}
          disabled={!canPlan || busy || review.files.length === 0}
        >
          {busy ? <Spinner className="size-4" /> : <SparklesIcon className="size-4" />}
          {busy ? 'Planning…' : 'Plan commits in chat'}
        </Button>
      </div>
    </div>
  )
}

/** Shared runtime + provider/model selector card — used by the generate gate and the regenerate dialog. */
function PlanConfigCard({
  composer,
  busy,
  className,
}: {
  composer: ReturnType<typeof useComposerState>
  busy: boolean
  className?: string
}) {
  const { runtimeOptions: commitPlanRuntimeOptions } = useProviderBackedDiffRuntimeSelection(composer.runtimeOptions)

  return (
    <div className={cn('space-y-4 rounded-xl border border-border bg-sidebar/40 p-4', className)}>
      <Field label="Tool runtime">
        <RuntimeSelector
          value={composer.selection.runtimeKind}
          onChange={composer.setRuntimeKind}
          options={commitPlanRuntimeOptions}
          disabled={busy}
        />
      </Field>
      <Field label="Provider & model">
        <ProviderModelSelector
          profiles={composer.profiles}
          selectedProfileId={composer.selection.profileId}
          selectedModelId={composer.selection.modelId}
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
  )
}

function PlanCostNote({ fileCount }: { fileCount: number }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
      <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Planning runs the selected runtime and model over this review and spends tokens.
        {fileCount > 0 && ` It covers ${fileCount} file${fileCount === 1 ? '' : 's'}.`}
      </span>
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

/**
 * Header trigger for re-planning. Opens a dialog with the full runtime / provider / model selector
 * (same config card as the generate gate) so the user can pick a model before spending tokens —
 * it never fires blindly from the header button alone.
 */
function PlanInChatButton({
  busy,
  filesCount,
  fileCount,
  onPlan,
  className,
}: {
  busy: boolean
  filesCount: number
  fileCount: number
  onPlan: (profileId: string | null, runtimeKind: string, modelId: string | null) => Promise<void> | void
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <RegenerateDialog
      open={open}
      onOpenChange={setOpen}
      busy={busy}
      fileCount={fileCount}
      filesCount={filesCount}
      onPlan={onPlan}
      triggerClassName={className}
    />
  )
}

function RegenerateDialog({
  open,
  onOpenChange,
  busy,
  fileCount,
  filesCount,
  onPlan,
  triggerClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  fileCount: number
  filesCount: number
  onPlan: (profileId: string | null, runtimeKind: string, modelId: string | null) => Promise<void> | void
  triggerClassName?: string
}) {
  const { t } = useTranslation('diff-review')
  const composer = useComposerState({ context: 'new-chat' })
  const runtimeKind = composer.selection.runtimeKind
  const profileId = composer.selection.profileId
  const modelId = composer.selection.modelId
  const { runtimeKindSet } = useProviderBackedDiffRuntimeSelection(composer.runtimeOptions)
  const canPlan = profileId != null && runtimeKindSet.has(runtimeKind)
  const disabled = busy || filesCount === 0 || !canPlan

  const handleGenerate = async () => {
    onOpenChange(false)
    await onPlan(profileId, runtimeKind, modelId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('gap-1.5 text-xs', triggerClassName)}
        onClick={() => onOpenChange(true)}
        disabled={busy}
        title={disabled && !busy && !canPlan ? 'Pick a runtime and provider first' : undefined}
      >
        {busy ? <Spinner className="size-3.5" /> : <RotateCcwIcon className="size-3.5" />}
        {busy ? 'Regenerating…' : 'Regenerate'}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Regenerate commit plan</DialogTitle>
          <DialogDescription>
            {t('plan.regenerate.description')}
          </DialogDescription>
        </DialogHeader>

        <PlanConfigCard composer={composer} busy={busy} />

        <PlanCostNote fileCount={fileCount} />

        <Button
          type="button"
          size="lg"
          className="mt-1 w-full"
          onClick={handleGenerate}
          disabled={disabled}
        >
          {busy ? <Spinner className="size-4" /> : <RotateCcwIcon className="size-4" />}
          {busy ? 'Regenerating…' : 'Regenerate plan'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// ─── Planning status & helpers ──────────────────────────────────────────────

function CommitPlanningStatusPanel({ fix }: { fix: ReviewAgentFix }) {
  const running = fix.status === 'pending' || fix.status === 'running'
  return (
    <div className={cn(
      'rounded-lg px-3 py-2 text-[11px] leading-relaxed',
      running
        ? 'border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        : 'border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400',
    )}
    >
      <div className="flex items-center gap-2 font-medium">
        {running && <Spinner className="size-3.5" />}
        <span>{running ? 'Planning commit sequence…' : 'Commit planning failed'}</span>
      </div>
      {fix.errorMessage && (
        <p className="mt-1 text-current/80">{fix.errorMessage}</p>
      )}
    </div>
  )
}

function latestAgentFix(review: CradleDiffReview, beforeIds: Set<string>): ReviewAgentFix | null {
  let latest: ReviewAgentFix | null = null
  for (const fix of review.agentFixes) {
    if (beforeIds.has(fix.id)) {
      continue
    }
    if (!latest || fix.createdAt > latest.createdAt) {
      latest = fix
    }
  }
  return latest
}

function latestCommitAgentFix(review: CradleDiffReview | null | undefined): ReviewAgentFix | null {
  let latest: ReviewAgentFix | null = null
  const currentRevision = review?.currentRevision
  if (!currentRevision) {
    return null
  }
  for (const fix of review?.agentFixes ?? []) {
    if (fix.expectedOutput !== 'commit') {
      continue
    }
    if (fix.targetRevisionId !== currentRevision.id) {
      continue
    }
    if (!latest || fix.createdAt > latest.createdAt) {
      latest = fix
    }
  }
  return latest
}
