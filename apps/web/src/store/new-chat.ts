import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { ChatRuntimeSettings } from '~/features/chat/commands/chat-response-command'

import { persistStorage } from './persist-storage'

type PersistedThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh' | null
export interface NewChatClaudeAgentConfig {
  modelAliases: ClaudeAgentModelAliases
}

interface NewChatState {
  lastRuntimeKind: RuntimeKind | null
  lastAgentId: string | null
  lastAgentProfileId: string | null
  /** map of profileId → last selected modelId */
  lastModelByProfile: Record<string, string>
  /** map of runtimeKind → last selected runtime-owned modelId */
  lastModelByRuntime: Record<string, string>
  /** map of profileId → draft Claude Agent model alias overrides */
  lastClaudeAgentByProfile: Record<string, NewChatClaudeAgentConfig>
  lastThinkingEffort: PersistedThinkingEffort
  lastRuntimeSettings: ChatRuntimeSettings
  setLastRuntimeKind: (kind: RuntimeKind | null) => void
  setLastAgentId: (id: string | null) => void
  setLastAgentProfileId: (id: string | null) => void
  setLastModelForProfile: (profileId: string, modelId: string | null) => void
  setLastModelForRuntime: (runtimeKind: RuntimeKind, modelId: string | null) => void
  setLastClaudeAgentForProfile: (profileId: string, config: NewChatClaudeAgentConfig | null) => void
  setLastThinkingEffort: (effort: PersistedThinkingEffort) => void
  setLastRuntimeSettings: (settings: ChatRuntimeSettings) => void
  getLastModelForProfile: (profileId: string) => string | undefined
  reconcileProfiles: (profileIds: string[]) => void
}

function areClaudeAgentConfigsEqual(
  left: NewChatClaudeAgentConfig | null,
  right: NewChatClaudeAgentConfig | null,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.modelAliases.haiku === right.modelAliases.haiku
    && left.modelAliases.sonnet === right.modelAliases.sonnet
    && left.modelAliases.opus === right.modelAliases.opus
}

export const useNewChatStore = create<NewChatState>()(
  persist(
    (set, get) => ({
      lastRuntimeKind: null,
      lastAgentId: null,
      lastAgentProfileId: null,
      lastModelByProfile: {},
      lastModelByRuntime: {},
      lastClaudeAgentByProfile: {},
      lastThinkingEffort: 'high',
      lastRuntimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
      setLastRuntimeKind: (kind) => {
        set((state) => {
          if (state.lastRuntimeKind === kind) {
            return state
          }
          return { lastRuntimeKind: kind }
        })
      },
      setLastAgentId: (id) => {
        set((state) => {
          if (state.lastAgentId === id) {
            return state
          }
          return { lastAgentId: id }
        })
      },
      setLastAgentProfileId: (id) => {
        set((state) => {
          if (state.lastAgentProfileId === id) {
            return state
          }
          return { lastAgentProfileId: id }
        })
      },
      setLastModelForProfile: (profileId, modelId) => {
        set((state) => {
          if (modelId === null) {
            if (!(profileId in state.lastModelByProfile)) {
              return state
            }
            const next = { ...state.lastModelByProfile }
            delete next[profileId]
            return { lastModelByProfile: next }
          }
          if (state.lastModelByProfile[profileId] === modelId) {
            return state
          }
          return {
            lastModelByProfile: { ...state.lastModelByProfile, [profileId]: modelId },
          }
        })
      },
      setLastModelForRuntime: (runtimeKind, modelId) => {
        set((state) => {
          if (modelId === null) {
            if (!(runtimeKind in state.lastModelByRuntime)) {
              return state
            }
            const next = { ...state.lastModelByRuntime }
            delete next[runtimeKind]
            return { lastModelByRuntime: next }
          }
          if (state.lastModelByRuntime[runtimeKind] === modelId) {
            return state
          }
          return {
            lastModelByRuntime: { ...state.lastModelByRuntime, [runtimeKind]: modelId },
          }
        })
      },
      setLastClaudeAgentForProfile: (profileId, config) => {
        set((state) => {
          if (areClaudeAgentConfigsEqual(state.lastClaudeAgentByProfile[profileId] ?? null, config)) {
            return state
          }
          const next = { ...state.lastClaudeAgentByProfile }
          if (config) {
            next[profileId] = config
          }
          else {
            delete next[profileId]
          }
          return { lastClaudeAgentByProfile: next }
        })
      },
      setLastThinkingEffort: (effort) => {
        set((state) => {
          if (state.lastThinkingEffort === effort) {
            return state
          }
          return { lastThinkingEffort: effort }
        })
      },
      setLastRuntimeSettings: (settings) => {
        set((state) => {
          if (
            state.lastRuntimeSettings.accessMode === settings.accessMode
            && state.lastRuntimeSettings.interactionMode === settings.interactionMode
          ) {
            return state
          }
          return { lastRuntimeSettings: settings }
        })
      },
      getLastModelForProfile: profileId => get().lastModelByProfile[profileId],
      reconcileProfiles: (profileIds) => {
        set((state) => {
          const allowed = new Set(profileIds)
          const lastAgentProfileId = state.lastAgentProfileId && allowed.has(state.lastAgentProfileId)
            ? state.lastAgentProfileId
            : null

          const lastModelByProfile = Object.fromEntries(
            Object.entries(state.lastModelByProfile).filter(([profileId]) => allowed.has(profileId)),
          )
          const lastClaudeAgentByProfile = Object.fromEntries(
            Object.entries(state.lastClaudeAgentByProfile).filter(([profileId]) => allowed.has(profileId)),
          )

          const modelsUnchanged = Object.keys(state.lastModelByProfile).length === Object.keys(lastModelByProfile).length
            && Object.entries(lastModelByProfile).every(([profileId, modelId]) => state.lastModelByProfile[profileId] === modelId)
          const claudeAgentsUnchanged = Object.keys(state.lastClaudeAgentByProfile).length === Object.keys(lastClaudeAgentByProfile).length
            && Object.entries(lastClaudeAgentByProfile).every(([profileId, config]) =>
              areClaudeAgentConfigsEqual(state.lastClaudeAgentByProfile[profileId] ?? null, config))

          if (state.lastAgentProfileId === lastAgentProfileId && modelsUnchanged && claudeAgentsUnchanged) {
            return state
          }

          return {
            lastAgentProfileId,
            lastModelByProfile,
            lastClaudeAgentByProfile,
          }
        })
      },
    }),
    {
      name: 'cradle:new-chat:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)
