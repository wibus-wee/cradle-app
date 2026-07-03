// This file is kept for backwards compatibility — all code lives in ./chat/
export { chatSelectors, createChatStore, getChatStoreTelemetrySnapshot, useChatStore } from './chat/store'
export type {
  AssistantDisplaySplit,
  ChatActiveGoal,
  ChatActiveGoalStatus,
  ChatError,
  ChatRunDisplayMeta,
  ChatRunState,
  ChatState,
  MessageReconcileChange,
  PassiveRunStateInput,
  PublicStatus,
} from './chat/types'
