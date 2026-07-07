/**
 * Codex plan composer slot UI.
 *
 * The provider owns the plan state. This rail only offers composer-level
 * follow-up actions and local dismissal for the current plan snapshot.
 */
import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  DownSmallLine as ChevronDownIcon,
  ExternalLinkLine as OpenPlanIcon,
  ListCheckLine as ListChecksIcon,
  TargetLine as TargetIcon,
} from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { ButtonGroup } from '~/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/cn'

import type { ChatRuntimePlanUiSlotState } from '../../capabilities/chat-capabilities'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import styles from './plan-slot-state.module.css'
import type { ComposerPlanSlotActions } from './types'

type PrimaryPlanAction = 'implement' | 'makeGoal'
type PlanAction = PrimaryPlanAction | 'open'

const PRIMARY_PLAN_ACTION_STORAGE_KEY = 'cradle:chat:plan-slot:primary-action:v1'

export function PlanSlotState({
  state,
  actions,
  className,
  onDismiss,
}: {
  state: ChatRuntimePlanUiSlotState
  actions?: ComposerPlanSlotActions
  className?: string
  onDismiss: () => void
}) {
  const [pendingAction, setPendingAction] = useState<PlanAction | null>(null)
  const [primaryAction, setPrimaryAction] = useState<PrimaryPlanAction>(() => readStoredPrimaryPlanAction())
  const summary = useMemo(() => readPlanSummary(state), [state])
  const disabled = actions?.disabled || actions?.busy || pendingAction !== null
  const primaryActionConfig = primaryPlanActionConfigs[primaryAction]
  const primaryHandler = readPrimaryPlanActionHandler(actions, primaryAction)
  const PrimaryIcon = primaryActionConfig.icon

  useEffect(() => {
    try {
      window.localStorage.setItem(PRIMARY_PLAN_ACTION_STORAGE_KEY, primaryAction)
    }
    catch {
      // Preference persistence is best-effort.
    }
  }, [primaryAction])

  return (
    <ComposerSlotShell stateName="plan" testId="plan-slot" className={cn(styles.shell, className)}>
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <ListChecksIcon className="size-3.5 shrink-0 !text-primary/75" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground/80">Plan ready</span>
          {summary && (
            <>
              <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
                ·
              </span>
              <span className="min-w-0 truncate text-foreground/75">{summary}</span>
            </>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ButtonGroup>
            <Button
              type="button"
              size="xs"
              disabled={disabled || !primaryHandler}
              aria-label={primaryActionConfig.label}
              onClick={() => {
                void runPlanAction(primaryAction, state, primaryHandler, setPendingAction, onDismiss)
              }}
              className={cn('h-6 gap-1 px-2', styles.actionButton)}
            >
              <PrimaryIcon className="size-3" aria-hidden="true" />
              <span className={styles.actionLabel}>{primaryActionConfig.label}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  disabled={disabled}
                  className="h-6 w-6 px-0"
                  aria-label="Select plan action"
                >
                  <ChevronDownIcon className="size-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup
                  value={primaryAction}
                  onValueChange={(value) => {
                    if (value === 'implement' || value === 'makeGoal') {
                      setPrimaryAction(value)
                    }
                  }}
                >
                  <DropdownMenuRadioItem value="implement" disabled={!actions?.onImplement}>
                    <CheckIcon className="size-3.5" aria-hidden="true" />
                    <span>Implement Plan</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="makeGoal" disabled={!actions?.onMakeGoal}>
                    <TargetIcon className="size-3.5" aria-hidden="true" />
                    <span>Make Goal</span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || !actions?.onRefine}
            aria-label="Open Plan"
            onClick={() => {
              void runPlanAction('open', state, actions?.onRefine, setPendingAction, onDismiss)
            }}
            className={cn('h-6 gap-1 px-2', styles.actionButton)}
          >
            <OpenPlanIcon className="size-3" aria-hidden="true" />
            <span className={styles.actionLabel}>Open Plan</span>
          </Button>
          <ComposerSlotIconAction
            label="Dismiss plan"
            disabled={pendingAction !== null}
            onClick={onDismiss}
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </ComposerSlotIconAction>
        </div>
      </div>
    </ComposerSlotShell>
  )
}

async function runPlanAction(
  action: PlanAction,
  state: ChatRuntimePlanUiSlotState,
  handler:
    | ComposerPlanSlotActions['onImplement']
    | ComposerPlanSlotActions['onRefine']
    | ComposerPlanSlotActions['onMakeGoal']
    | undefined,
  setPendingAction: (action: PlanAction | null) => void,
  onHandled: () => void,
) {
  if (!handler) {
    return
  }

  setPendingAction(action)
  try {
    const result = await handler(state)
    if (result !== false) {
      onHandled()
    }
  }
  catch (error) {
    console.error('[PlanSlotState] action failed:', error)
  }
  finally {
    setPendingAction(null)
  }
}

const primaryPlanActionConfigs: Record<PrimaryPlanAction, {
  icon: typeof CheckIcon
  label: string
}> = {
  implement: {
    icon: CheckIcon,
    label: 'Implement Plan',
  },
  makeGoal: {
    icon: TargetIcon,
    label: 'Make Goal',
  },
}

function readPrimaryPlanActionHandler(
  actions: ComposerPlanSlotActions | undefined,
  action: PrimaryPlanAction,
) {
  return action === 'makeGoal' ? actions?.onMakeGoal : actions?.onImplement
}

function readStoredPrimaryPlanAction(): PrimaryPlanAction {
  try {
    const stored = window.localStorage.getItem(PRIMARY_PLAN_ACTION_STORAGE_KEY)
    return stored === 'makeGoal' ? 'makeGoal' : 'implement'
  }
  catch {
    return 'implement'
  }
}

function readPlanSummary(state: ChatRuntimePlanUiSlotState): string | null {
  const content = state.content?.trim()
  if (content) {
    return content.split('\n').find(line => line.trim())?.trim() ?? null
  }

  const explanation = state.explanation?.trim()
  if (explanation) {
    return explanation
  }

  const step = state.currentStep ?? state.steps[0]?.step ?? null
  if (step?.trim()) {
    return step.trim()
  }

  const totalCount = state.pendingCount + state.inProgressCount + state.completedCount
  return totalCount > 0 ? `${totalCount} steps` : null
}
