/**
 * Shared composer slot contracts owned by the chat feature.
 *
 * These types keep the composer slot dispatcher thin while individual slot
 * renderers own their own UI details.
 */
import type { ChatRuntimeGoalUiSlotState, ChatRuntimePlanUiSlotState } from '../../capabilities/chat-capabilities'

export interface ComposerGoalSlotActions {
  busy?: boolean
  onEdit?: (state: ChatRuntimeGoalUiSlotState) => void
  onPause?: (state: ChatRuntimeGoalUiSlotState) => void
  onResume?: (state: ChatRuntimeGoalUiSlotState) => void
  onClear?: (state: ChatRuntimeGoalUiSlotState) => void
}

export interface ComposerPlanSlotActions {
  busy?: boolean
  disabled?: boolean
  onImplement?: (state: ChatRuntimePlanUiSlotState) => void | boolean | Promise<void | boolean>
  onRefine?: (state: ChatRuntimePlanUiSlotState) => void | boolean | Promise<void | boolean>
  onMakeGoal?: (state: ChatRuntimePlanUiSlotState) => void | boolean | Promise<void | boolean>
}

export interface ComposerReviewSlotActions {
  open: boolean
  workspaceId?: string | null
  onDismiss: () => void
  onSubmitPrompt: (prompt: string) => void
  resolveMergeBase: (baseBranch: string, repositoryPath?: string | null) => Promise<string | null>
}

export interface ComposerUsageSlotActions {
  open: boolean
  onDismiss: () => void
}

export interface ComposerQuickQuestionSlotActions {
  open: boolean
  question: string
  sessionId: string
  onDismiss: () => void
}
