import {
  CheckCircleLine as CheckCircleIcon,
  CloseLine as XIcon,
  DeleteLine as TrashIcon,
  Message3Line as MessageCircleIcon,
  PlayCircleLine as PlayCircleIcon,
  Refresh1Line as RefreshCwIcon,
  RobotLine as BotIcon,
  Settings3Line as SettingsIcon,
} from '@mingcute/react'
import { Spinner } from '~/components/ui/spinner'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { AgentSelector, useComposerState } from '~/features/composer-toolbar'
import { cn } from '~/lib/cn'
import { openChatSession, openSettingsSection } from '~/navigation/navigation-commands'

import { formatTimestamp } from '../shared/diff-items'
import type { CradleDiffReview, ReviewAgentFix, ReviewThreadAnchorInput } from '../shared/types'

interface AgentRailProps {
  review: CradleDiffReview
  selectedAnchor: ReviewThreadAnchorInput | null
  selectedLabel: string | null
  createPending: boolean
  startPending: boolean
  cancelPending: boolean
  rerunPending: boolean
  deletePending: boolean
  onCreate: (input: {
    anchor?: ReviewThreadAnchorInput | null
    threadId?: string | null
    instruction: string
    agentId?: string | null
    expectedOutput: 'commit' | 'working-tree-change' | 'patch-artifact'
  }) => Promise<CradleDiffReview>
  onStart: (input: {
    agentFixId: string
    agentId?: string | null
  }) => Promise<CradleDiffReview>
  onCancel: (agentFixId: string) => void
  onRerun: (input: {
    agentFixId: string
    agentId?: string | null
  }) => Promise<CradleDiffReview>
  onDelete: (agentFixId: string) => void
  onCollapse: () => void
  width: number
}

const STATUS_TONE: Record<ReviewAgentFix['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
}

function latestAgentFix(review: CradleDiffReview, beforeIds: Set<string>): ReviewAgentFix | null {
  return review.agentFixes
    .filter(fix => !beforeIds.has(fix.id))
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
}

export function AgentRail({
  review,
  selectedAnchor,
  selectedLabel,
  createPending,
  startPending,
  cancelPending,
  rerunPending,
  deletePending,
  onCreate,
  onStart,
  onCancel,
  onRerun,
  onDelete,
  onCollapse,
  width,
}: AgentRailProps) {
  const composer = useComposerState({ context: 'new-chat', enableAgents: true })
  const [instruction, setInstruction] = useState('')
  const [scope, setScope] = useState<'selection' | 'review'>(selectedAnchor ? 'selection' : 'review')
  const [error, setError] = useState<string | null>(null)

  const targetAnchor = scope === 'selection' ? selectedAnchor : null
  const agentId = composer.selection.agentId
  const busy = createPending || startPending
  const canRun = Boolean(agentId) && Boolean(instruction.trim()) && !busy

  const sortedFixes = useMemo(
    () => [...review.agentFixes].sort((left, right) => right.createdAt - left.createdAt),
    [review.agentFixes],
  )

  const createAndStart = async () => {
    const body = instruction.trim()
    if (!body || !agentId || busy) {
      return
    }
    setError(null)
    const beforeIds = new Set(review.agentFixes.map(fix => fix.id))
    try {
      const createdReview = await onCreate({
        anchor: targetAnchor,
        instruction: body,
        agentId,
        expectedOutput: 'working-tree-change',
      })
      const created = latestAgentFix(createdReview, beforeIds)
      if (!created) {
        throw new Error('Agent work order was not created')
      }
      await onStart({
        agentFixId: created.id,
        agentId,
      })
      setInstruction('')
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col border-l border-border/60 bg-background"
      style={{ width }}
      data-testid="agent-rail"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
        <BotIcon className="size-3.5 !text-muted-foreground/60" aria-hidden />
        <span className="text-[12px] font-medium text-foreground/70">Agent</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">{review.agentFixes.length}</span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCollapse}
          className="size-5 rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          aria-label="Hide agent"
        >
          <XIcon className="size-3" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b border-border/60 p-3">
          <div className="flex rounded-md bg-muted/60 p-0.5">
            <ScopeButton active={scope === 'selection'} disabled={!selectedAnchor} onClick={() => setScope('selection')}>
              Selection
            </ScopeButton>
            <ScopeButton active={scope === 'review'} onClick={() => setScope('review')}>
              Review
            </ScopeButton>
          </div>

          <div className="space-y-1.5">
            <p className="truncate text-[11px] text-muted-foreground">
              {targetAnchor ? selectedLabel : 'Use the full current review as context'}
            </p>
            <Textarea
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              placeholder="Ask the agent what to change..."
              className="min-h-20 resize-none text-[12px]"
            />
          </div>

          <AgentSelector
            agents={composer.agents}
            selectedAgentId={agentId}
            runtimeOptions={composer.runtimeOptions}
            onSelectAgent={composer.setAgentId}
          />

          {composer.agents.length === 0 && (
            <div className="rounded-md border border-dashed border-current/15 bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground/80">
              <p>No agent is configured yet.</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openSettingsSection('agents')}
                className="mt-1.5 h-auto gap-1 px-0 py-0 text-[11px] text-foreground/80 underline-offset-2 hover:bg-transparent hover:underline"
              >
                <SettingsIcon className="size-3" />
                Configure one in Agents
              </Button>
            </div>
          )}

          {error && (
            <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <Button
            type="button"
            size="sm"
            className="h-7 w-full text-[12px]"
            disabled={!canRun}
            onClick={createAndStart}
          >
            {busy ? <Spinner className="size-3.5" /> : <PlayCircleIcon className="size-3.5" />}
            Start agent
          </Button>
        </div>

        <div className="py-1">
          {sortedFixes.length === 0
            ? (
                <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
                  <BotIcon className="size-4 !text-muted-foreground/30" aria-hidden />
                  <p className="text-[11px] text-muted-foreground/60">No agent work yet</p>
                </div>
              )
            : sortedFixes.map(fix => (
                <AgentFixRow
                  key={fix.id}
                  fix={fix}
                  startPending={startPending}
                  cancelPending={cancelPending}
                  rerunPending={rerunPending}
                  deletePending={deletePending}
                  agentId={agentId}
                  onStart={onStart}
                  onCancel={onCancel}
                  onRerun={onRerun}
                  onDelete={onDelete}
                />
              ))}
        </div>
      </div>
    </aside>
  )
}

function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-6 flex-1 rounded-[5px] px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Button>
  )
}

function AgentFixRow({
  fix,
  startPending,
  cancelPending,
  rerunPending,
  deletePending,
  agentId,
  onStart,
  onCancel,
  onRerun,
  onDelete,
}: {
  fix: ReviewAgentFix
  startPending: boolean
  cancelPending: boolean
  rerunPending: boolean
  deletePending: boolean
  agentId: string | null
  onStart: AgentRailProps['onStart']
  onCancel: AgentRailProps['onCancel']
  onRerun: AgentRailProps['onRerun']
  onDelete: AgentRailProps['onDelete']
}) {
  const canStart = fix.status === 'pending' && Boolean(agentId)
  const canCancel = fix.status === 'running'
  const canRerun = fix.status === 'completed' || fix.status === 'failed' || fix.status === 'cancelled'
  const hasRerunTarget = Boolean(agentId) || Boolean(fix.profileId)
  // Only terminal-state work orders can be removed from the rail — pending
  // and running work orders must be started or cancelled first to keep the
  // audit trail consistent.
  const canDelete = fix.status === 'completed' || fix.status === 'failed' || fix.status === 'cancelled'

  return (
    <div className="border-b border-border/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_TONE[fix.status])}>
          {fix.status}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/50">{formatTimestamp(fix.createdAt)}</span>
      </div>
      <p className="line-clamp-2 text-[12px] leading-relaxed text-foreground/85">{fix.instruction}</p>
      {fix.errorMessage && (
        <p className="mt-1 rounded bg-red-500/10 px-1.5 py-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
          {fix.errorMessage}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {fix.sessionId && (
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => openChatSession(fix.sessionId!)}>
            <MessageCircleIcon className="size-3" />
            Open chat
          </Button>
        )}
        {canStart && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={startPending}
            onClick={() => onStart({ agentFixId: fix.id, agentId })}
          >
            {startPending ? <Spinner className="size-3" /> : <PlayCircleIcon className="size-3" />}
            Start
          </Button>
        )}
        {canCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={cancelPending}
            onClick={() => onCancel(fix.id)}
          >
            <XIcon className="size-3" />
            Cancel
          </Button>
        )}
        {canRerun && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            disabled={rerunPending || !hasRerunTarget}
            onClick={() => onRerun({ agentFixId: fix.id, agentId })}
          >
            <RefreshCwIcon className="size-3" />
            Rerun
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/70 hover:text-red-600 dark:hover:text-red-400"
            disabled={deletePending}
            onClick={() => onDelete(fix.id)}
            aria-label="Delete agent fix work order"
          >
            {deletePending ? <Spinner className="size-3" /> : <TrashIcon className="size-3" />}
            Delete
          </Button>
        )}
        {fix.status === 'completed' && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="size-3" />
            Done
          </span>
        )}
      </div>
    </div>
  )
}
