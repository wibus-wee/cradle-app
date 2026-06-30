// This file is kept for backwards compatibility — all code lives in ./chat/
export { chatSelectors, getChatStoreTelemetrySnapshot, useChatStore } from './chat/store'
export type {
  AssistantDisplaySplit,
  ChatActiveGoal,
  ChatActiveGoalStatus,
  ChatError,
  ChatRunDisplayMeta,
  ChatState,
  MessageReconcileChange,
  PublicStatus,
  SessionMeta,
} from './chat/types'
