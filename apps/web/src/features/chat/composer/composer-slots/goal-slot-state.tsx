/**
 * Codex goal composer slot UI.
 *
 * The component renders only goal-owned state and actions; the parent decides
 * whether the provider exposed this slot on the composer surface.
 */
import {
  CheckCircleLine as CheckCircle2Icon,
  Dashboard2Line as GaugeIcon,
  DeleteLine as Trash2Icon,
  ForbidCircleLine as CircleSlashIcon,
  PauseCircleLine as CirclePauseIcon,
  PencilLine as PencilIcon,
  TargetLine as TargetIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { clampPercent, formatElapsedSeconds } from '~/lib/number-format'

import type { ChatRuntimeGoalUiSlotState } from '../../capabilities/chat-capabilities'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import type { ComposerGoalSlotActions } from './types'

export function GoalSlotState({
  state,
  actions,
  className,
}: {
  state: ChatRuntimeGoalUiSlotState
  actions?: ComposerGoalSlotActions
  className?: string
}) {
  const budgetPercent = readGoalBudgetPercent(state)
  const statusToneClassName = readGoalStatusToneClassName(state.status)
  const displayedTimeUsedSeconds = useDisplayedGoalTimeUsedSeconds(state)
  const elapsedLabel = formatElapsedSeconds(displayedTimeUsedSeconds)
  const goalStatusAction = readGoalStatusAction(state.status)

  return (
    <ComposerSlotShell stateName="goal" className={className}>
      <div className="flex h-6 min-w-0 items-center gap-2">
        <TargetIcon className={cn('size-3.5 shrink-0', statusToneClassName)} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground/75">
            {readGoalStatusHeading(state.status)}
          </span>
          <span className="min-w-0 truncate text-foreground/80">{state.objective}</span>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {elapsedLabel}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <ComposerSlotIconAction
            label="Edit goal"
            disabled={!actions?.onEdit || actions.busy}
            onClick={() => actions?.onEdit?.(state)}
          >
            <PencilIcon className="size-3.5" aria-hidden="true" />
          </ComposerSlotIconAction>
          {goalStatusAction && (
            <ComposerSlotIconAction
              label={goalStatusAction.label}
              disabled={actions?.busy || (goalStatusAction.kind === 'resume' ? !actions?.onResume : !actions?.onPause)}
              onClick={() => {
                if (goalStatusAction.kind === 'resume') {
                  actions?.onResume?.(state)
                  return
                }
                actions?.onPause?.(state)
              }}
            >
              {renderGoalStatusIcon(state.status)}
            </ComposerSlotIconAction>
          )}
          <ComposerSlotIconAction
            label="Clear goal"
            disabled={!actions?.onClear || actions.busy}
            onClick={() => actions?.onClear?.(state)}
          >
            <Trash2Icon className="size-3.5" aria-hidden="true" />
          </ComposerSlotIconAction>
        </div>
      </div>
      {budgetPercent !== null && (
        <div className="flex items-center gap-2 pl-5">
          <Progress value={budgetPercent} className="h-0.5 flex-1 bg-muted/60" />
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {state.tokensUsed}
            /
            {state.tokenBudget}
          </span>
        </div>
      )}
    </ComposerSlotShell>
  )
}

function useDisplayedGoalTimeUsedSeconds(state: ChatRuntimeGoalUiSlotState): number {
  const isActive = state.status === 'active'
  const nowSeconds = useGoalDisplayNowSeconds(isActive)
  const baseTimeUsedSeconds = Math.max(0, Math.floor(state.timeUsedSeconds))

  if (!isActive) {
    return baseTimeUsedSeconds
  }

  return baseTimeUsedSeconds + Math.max(0, nowSeconds - Math.floor(state.updatedAt))
}

function useGoalDisplayNowSeconds(active: boolean): number {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1_000))

  useEffect(() => {
    if (!active) {
      return
    }

    const intervalId = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1_000))
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [active])

  return nowSeconds
}

function readGoalBudgetPercent(state: ChatRuntimeGoalUiSlotState): number | null {
  if (state.tokenBudget === null || state.tokenBudget <= 0) {
    return null
  }
  return clampPercent((state.tokensUsed / state.tokenBudget) * 100)
}

function renderGoalStatusIcon(status: ChatRuntimeGoalUiSlotState['status']) {
  switch (status) {
    case 'complete':
      return <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
    case 'paused':
      return <GaugeIcon className="size-3.5" aria-hidden="true" />
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return <CircleSlashIcon className="size-3.5" aria-hidden="true" />
    case 'active':
    default:
      return <CirclePauseIcon className="size-3.5" aria-hidden="true" />
  }
}

function readGoalStatusAction(status: ChatRuntimeGoalUiSlotState['status']): { kind: 'pause' | 'resume', label: string } | null {
  switch (status) {
    case 'active':
      return { kind: 'pause', label: 'Pause goal' }
    case 'paused':
    case 'blocked':
      return { kind: 'resume', label: 'Resume goal' }
    case 'budgetLimited':
    case 'complete':
    case 'usageLimited':
    default:
      return null
  }
}

function readGoalStatusHeading(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'Completed goal'
    case 'paused':
      return 'Paused goal'
    case 'blocked':
      return 'Blocked goal'
    case 'usageLimited':
      return 'Usage-limited goal'
    case 'budgetLimited':
      return 'Budget-limited goal'
    case 'active':
    default:
      return 'Active goal'
  }
}

function readGoalStatusToneClassName(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return 'text-destructive'
    case 'paused':
      return 'text-amber-600 dark:text-amber-400'
    case 'active':
    default:
      return 'text-muted-foreground'
  }
}
