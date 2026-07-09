import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { RuntimeSettings, RuntimeSettingsPatch } from '~/features/chat/commands/chat-response-command'

import { persistStorage } from './persist-storage'

type PersistedThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
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
  lastRuntimeSettingsByKind: Partial<Record<RuntimeKind, RuntimeSettings>>
  setLastRuntimeKind: (kind: RuntimeKind | null) => void
  setLastAgentId: (id: string | null) => void
  setLastAgentProfileId: (id: string | null) => void
  setLastModelForProfile: (profileId: string, modelId: string | null) => void
  setLastModelForRuntime: (runtimeKind: RuntimeKind, modelId: string | null) => void
  setLastClaudeAgentForProfile: (profileId: string, config: NewChatClaudeAgentConfig | null) => void
  setLastThinkingEffort: (effort: PersistedThinkingEffort) => void
  patchLastRuntimeSettings: (runtimeKind: RuntimeKind, patch: RuntimeSettingsPatch) => void
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

function areRuntimeSettingsEqual(left: RuntimeSettings, right: RuntimeSettings): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  return leftKeys.every(key => left[key] === right[key])
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
      lastRuntimeSettingsByKind: {},
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
      patchLastRuntimeSettings: (runtimeKind, patch) => {
        set((state) => {
          const current = state.lastRuntimeSettingsByKind[runtimeKind] ?? {}
          const next: RuntimeSettings = { ...current }
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
              continue
            }
            if (value === null) {
              delete next[key]
              continue
            }
            next[key] = value
          }
          if (areRuntimeSettingsEqual(current, next)) {
            return state
          }
          return {
            lastRuntimeSettingsByKind: {
              ...state.lastRuntimeSettingsByKind,
              [runtimeKind]: next,
            },
          }
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
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>
        if (version < 2) {
          const legacy = state.lastRuntimeSettings as RuntimeSettings | undefined
          if (legacy && typeof legacy === 'object') {
            return {
              ...state,
              lastRuntimeSettingsByKind: {
                codex: legacy,
                opencode: legacy,
              },
            }
          }
          return {
            ...state,
            lastRuntimeSettingsByKind: {},
          }
        }
        return persisted as NewChatState
      },
    },
  ),
)
