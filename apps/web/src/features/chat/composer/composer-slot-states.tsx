import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimePlanUiSlotState,
  ChatRuntimeProgressUiSlotState,
  ChatRuntimeTerminalUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
  ChatRuntimeUsageUiSlotState,
  ChatRuntimeUserInputUiSlotState,
} from '../capabilities/chat-capabilities'
import { GoalSlotState } from './composer-slots/goal-slot-state'
import { PlanSlotState } from './composer-slots/plan-slot-state'
import { ProgressSlotState } from './composer-slots/progress-slot-state'
import { QuickQuestionSlotState } from './composer-slots/quick-question-slot-state'
import { ReviewSlotState } from './composer-slots/review-slot-state'
import { TerminalSlotState } from './composer-slots/terminal-slot-state'
import type {
  ComposerGoalSlotActions,
  ComposerPlanSlotActions,
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer-slots/types'
import { UsageSlotState } from './composer-slots/usage-slot-state'
import { UserInputSlotState } from './composer-slots/user-input-slot-state'

export type {
  ComposerGoalSlotActions,
  ComposerPlanSlotActions,
  ComposerQuickQuestionSlotActions,
  ComposerReviewSlotActions,
  ComposerUsageSlotActions,
} from './composer-slots/types'

const COMPOSER_SLOT_LAYOUT_TRANSITION = { duration: 0.36, ease: [0.22, 1, 0.36, 1] } as const
const COMPOSER_SLOT_CONTENT_ENTER_TRANSITION = {
  type: 'spring',
  duration: 0.42,
  bounce: 0,
} as const
const COMPOSER_SLOT_CONTENT_EXIT_TRANSITION = { duration: 0.18, ease: [0.4, 0, 0.2, 1] } as const
const COMPOSER_SLOT_REDUCED_TRANSITION = { duration: 0 } as const
const COMPOSER_SLOT_STAGGER_SECONDS = 0.035

type ComposerSlotEntry = { key: string, node: ReactNode }
type ComposerProgressState = ChatRuntimePlanUiSlotState | ChatRuntimeProgressUiSlotState

interface ComposerSlotStatesProps {
  sessionId?: string | null
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  actions?: ComposerGoalSlotActions
  plan?: ComposerPlanSlotActions
  quickQuestion?: ComposerQuickQuestionSlotActions
  review?: ComposerReviewSlotActions
  usage?: ComposerUsageSlotActions
  className?: string
  dismissPlanSignal?: number
  hidePlan?: boolean
}

export function ComposerSlotStates({
  sessionId,
  slots,
  states,
  actions,
  plan,
  quickQuestion,
  review,
  usage,
  className,
  dismissPlanSignal,
  hidePlan,
}: ComposerSlotStatesProps) {
  const [retainedPlanState, setRetainedPlanState] = useState<ChatRuntimePlanUiSlotState | null>(null)
  const [dismissedPlanKey, setDismissedPlanKey] = useState<string | null>(null)
  const composerSlotIds = useMemo(
    () =>
      new Set(
        slots.filter(slot => slot.surfaces.includes('composerState')).map(slot => slot.id),
      ),
    [slots],
  )
  const usageState = states.find((state): state is ChatRuntimeUsageUiSlotState => {
    return state.kind === 'usage' && usage?.open === true
  })
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })
  const standaloneProgressState = findComposerStandaloneProgressState(states, composerSlotIds)
  const planState = states.find((state): state is ChatRuntimePlanUiSlotState => {
    return (
      state.kind === 'plan' && composerSlotIds.has(state.slotId) && isComposerPlanReadyState(state)
    )
  })
  const userInputState
    = states.find((state): state is ChatRuntimeUserInputUiSlotState => {
      return state.kind === 'userInput' && composerSlotIds.has(state.slotId)
    }) ?? null
  const terminalState
    = states.find((state): state is ChatRuntimeTerminalUiSlotState => {
      return state.kind === 'terminal' && composerSlotIds.has(state.slotId)
    }) ?? null
  const renderedPlanState = planState ?? retainedPlanState
  const planKey = renderedPlanState ? readPlanSlotKey(renderedPlanState) : null
  const planKeyRef = useRef<string | null>(planKey)
  const retainedPlanKeyRef = useRef<string | null>(planKey)
  const dismissPlanSignalRef = useRef<number | undefined>(dismissPlanSignal)
  const visiblePlanState = renderedPlanState && dismissedPlanKey !== planKey && !hidePlan
    ? renderedPlanState
    : null
  useEffect(() => {
    if (!planState) {
      return
    }
    const nextPlanKey = readPlanSlotKey(planState)
    const previousPlanKey = retainedPlanKeyRef.current
    retainedPlanKeyRef.current = nextPlanKey
    setRetainedPlanState(planState)
    if (previousPlanKey !== nextPlanKey) {
      setDismissedPlanKey(current => current === nextPlanKey ? null : current)
    }
  }, [planState])

  useEffect(() => {
    planKeyRef.current = planKey
  }, [planKey])

  useEffect(() => {
    if (dismissPlanSignalRef.current === dismissPlanSignal) {
      return
    }
    dismissPlanSignalRef.current = dismissPlanSignal
    const currentPlanKey = planKeyRef.current
    if (currentPlanKey && dismissPlanSignal !== undefined) {
      setDismissedPlanKey(currentPlanKey)
    }
  }, [dismissPlanSignal])

  const entryCandidates: Array<ComposerSlotEntry | null> = [
    usageState
      ? {
        key: 'usage',
        node: <UsageSlotState state={usageState} usage={usage} className={className} />,
      }
      : null,
    goalState
      ? {
        key: 'goal',
        node: (
          <GoalSlotState
            state={goalState}
            actions={actions}
            className={className}
          />
        ),
      }
      : null,
    standaloneProgressState
      ? {
        key: `progress:${standaloneProgressState.slotId}:${standaloneProgressState.threadId}:${standaloneProgressState.turnId ?? 'turn'}`,
        node: <ProgressSlotState state={standaloneProgressState} className={className} />,
      }
      : null,
    visiblePlanState
      ? {
        key: 'plan',
        node: (
          <PlanSlotState
            state={visiblePlanState}
            actions={plan}
            className={className}
            onDismiss={() => {
              setDismissedPlanKey(planKey)
            }}
          />
        ),
      }
      : null,
    userInputState && sessionId
      ? {
        key: `user-input:${userInputState.requestId}`,
        node: (
          <UserInputSlotState
            state={userInputState}
            sessionId={sessionId}
            className={className}
          />
        ),
      }
      : null,
    terminalState && sessionId
      ? {
        key: `terminal:${terminalState.threadId}`,
        node: (
          <TerminalSlotState
            state={terminalState}
            sessionId={sessionId}
            className={className}
          />
        ),
      }
      : null,
    quickQuestion?.open
      ? {
        key: 'quick-question',
        node: <QuickQuestionSlotState quickQuestion={quickQuestion} className={className} />,
      }
      : null,
    review?.open
      ? {
        key: 'review',
        node: <ReviewSlotState review={review} className={className} />,
      }
      : null,
  ]
  const entries = entryCandidates.filter((entry): entry is ComposerSlotEntry => entry !== null)

  return (
    <AnimatePresence initial={false}>
      {entries.map((entry, index) => (
        <ComposerSlotMotionItem key={entry.key} index={index}>
          {entry.node}
        </ComposerSlotMotionItem>
      ))}
    </AnimatePresence>
  )
}

function ComposerSlotMotionItem({ index, children }: { index: number, children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion()
  const hiddenState = shouldReduceMotion
    ? { 'y': 0, '--composer-slot-content-blur': '0px', '--composer-slot-content-opacity': 0 }
    : { 'y': 18, '--composer-slot-content-blur': '2px', '--composer-slot-content-opacity': 0 }
  const visibleState = shouldReduceMotion
    ? { 'y': 0, '--composer-slot-content-blur': '0px', '--composer-slot-content-opacity': 1 }
    : { 'y': 0, '--composer-slot-content-blur': '0px', '--composer-slot-content-opacity': 1 }

  return (
    <m.div
      initial={{ height: 0 }}
      animate={{ height: 'auto' }}
      exit={{ height: 0 }}
      transition={
        shouldReduceMotion ? COMPOSER_SLOT_REDUCED_TRANSITION : COMPOSER_SLOT_LAYOUT_TRANSITION
      }
      className="overflow-hidden -mb-0.5"
    >
      <m.div
        initial={hiddenState}
        animate={{
          ...visibleState,
          transition: shouldReduceMotion
            ? COMPOSER_SLOT_REDUCED_TRANSITION
            : {
              ...COMPOSER_SLOT_CONTENT_ENTER_TRANSITION,
              delay: index * COMPOSER_SLOT_STAGGER_SECONDS,
            },
        }}
        exit={{
          ...hiddenState,
          transition: shouldReduceMotion
            ? COMPOSER_SLOT_REDUCED_TRANSITION
            : COMPOSER_SLOT_CONTENT_EXIT_TRANSITION,
        }}
      >
        {children}
      </m.div>
    </m.div>
  )
}

function readPlanSlotKey(state: ChatRuntimePlanUiSlotState): string {
  return `${state.threadId}:${state.turnId ?? 'turn'}:${state.updatedAt}`
}

function isComposerPlanReadyState(state: ChatRuntimePlanUiSlotState): boolean {
  return !!state.content?.trim()
}

function findComposerStandaloneProgressState(
  states: ChatRuntimeUiSlotState[],
  composerSlotIds: ReadonlySet<string>,
): ComposerProgressState | null {
  const progressState = states.find((state): state is ChatRuntimeProgressUiSlotState => {
    return (
      state.kind === 'progress'
      && composerSlotIds.has(state.slotId)
      && isComposerStandaloneProgressState(state)
    )
  })
  if (progressState) {
    return progressState
  }

  return states.find((state): state is ChatRuntimePlanUiSlotState => {
    return (
      state.kind === 'plan'
      && composerSlotIds.has(state.slotId)
      && isComposerStandaloneProgressState(state)
    )
  }) ?? null
}

function isComposerStandaloneProgressState(state: ComposerProgressState): boolean {
  return readComposerProgressItemCount(state) > 0 && (state.pendingCount > 0 || state.inProgressCount > 0)
}

function readComposerProgressItemCount(state: ComposerProgressState): number {
  return state.kind === 'progress' ? state.items.length : state.steps.length
}
