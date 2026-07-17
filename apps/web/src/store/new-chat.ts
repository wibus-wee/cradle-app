import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { RuntimeSettings, RuntimeSettingsPatch } from '~/features/chat/commands/chat-response-command'

import { persistStorage } from './persist-storage'

type PersistedThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | null
export interface NewChatClaudeAgentConfig {
  modelAliases: ClaudeAgentModelAliases
}

interface NewChatState {
  lastRuntimeKind: RuntimeKind | null
  lastAgentId: string | null
  lastAcpAgentId: string | null
  lastAgentProfileId: string | null
  /** map of profileId → last selected modelId */
  lastModelByProfile: Record<string, string>
  /** map of runtimeKind → last selected runtime-owned modelId */
  lastModelByRuntime: Record<string, string>
  /** map of profileId → draft Claude Agent model alias overrides */
  lastClaudeAgentByProfile: Record<string, NewChatClaudeAgentConfig>
  /** Global fallback when no provider-specific thinking is stored */
  lastThinkingEffort: PersistedThinkingEffort
  /** map of profileId → last selected thinking effort for that provider */
  lastThinkingByProfile: Record<string, PersistedThinkingEffort>
  /** map of profileId → modelId → last selected thinking effort */
  lastThinkingByProviderModel: Record<string, Record<string, PersistedThinkingEffort>>
  lastRuntimeSettingsByKind: Partial<Record<RuntimeKind, RuntimeSettings>>
  setLastRuntimeKind: (kind: RuntimeKind | null) => void
  setLastAgentId: (id: string | null) => void
  setLastAcpAgentId: (id: string | null) => void
  setLastAgentProfileId: (id: string | null) => void
  setLastModelForProfile: (profileId: string, modelId: string | null) => void
  setLastModelForRuntime: (runtimeKind: RuntimeKind, modelId: string | null) => void
  setLastClaudeAgentForProfile: (profileId: string, config: NewChatClaudeAgentConfig | null) => void
  setLastThinkingEffort: (effort: PersistedThinkingEffort) => void
  setLastThinkingForProfile: (profileId: string, effort: PersistedThinkingEffort) => void
  setLastThinkingForProviderModel: (profileId: string, modelId: string, effort: PersistedThinkingEffort) => void
  patchLastRuntimeSettings: (runtimeKind: RuntimeKind, patch: RuntimeSettingsPatch) => void
  getLastModelForProfile: (profileId: string) => string | undefined
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
      lastAcpAgentId: null,
      lastAgentProfileId: null,
      lastModelByProfile: {},
      lastModelByRuntime: {},
      lastClaudeAgentByProfile: {},
      lastThinkingEffort: 'high',
      lastThinkingByProfile: {},
      lastThinkingByProviderModel: {},
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
      setLastAcpAgentId: (id) => {
        set((state) => {
          if (state.lastAcpAgentId === id) {
            return state
          }
          return { lastAcpAgentId: id }
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
      setLastThinkingForProfile: (profileId, effort) => {
        set((state) => {
          if (effort === null) {
            if (!(profileId in state.lastThinkingByProfile)) {
              return state
            }
            const next = { ...state.lastThinkingByProfile }
            delete next[profileId]
            return { lastThinkingByProfile: next }
          }
          if (state.lastThinkingByProfile[profileId] === effort) {
            return state
          }
          return {
            lastThinkingByProfile: { ...state.lastThinkingByProfile, [profileId]: effort },
          }
        })
      },
      setLastThinkingForProviderModel: (profileId, modelId, effort) => {
        set((state) => {
          const currentByModel = state.lastThinkingByProviderModel[profileId] ?? {}
          if (effort === null) {
            if (!(modelId in currentByModel)) {
              return state
            }
            const nextByModel = { ...currentByModel }
            delete nextByModel[modelId]
            const nextByProvider = { ...state.lastThinkingByProviderModel }
            if (Object.keys(nextByModel).length === 0) {
              delete nextByProvider[profileId]
            }
            else {
              nextByProvider[profileId] = nextByModel
            }
            return { lastThinkingByProviderModel: nextByProvider }
          }
          if (currentByModel[modelId] === effort) {
            return state
          }
          return {
            lastThinkingByProviderModel: {
              ...state.lastThinkingByProviderModel,
              [profileId]: { ...currentByModel, [modelId]: effort },
            },
          }
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
    }),
    {
      name: 'cradle:new-chat:v1',
      storage: persistStorage,
      version: 5,
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
              lastThinkingByProfile: {},
              lastThinkingByProviderModel: {},
            }
          }
          return {
            ...state,
            lastRuntimeSettingsByKind: {},
            lastThinkingByProfile: {},
            lastThinkingByProviderModel: {},
          }
        }
        if (version < 3) {
          return {
            ...state,
            lastThinkingByProfile: {},
            lastThinkingByProviderModel: {},
          }
        }
        if (version < 4) {
          return {
            ...state,
            lastThinkingByProviderModel: {},
          }
        }
        if (version < 5) {
          return {
            ...state,
            lastAcpAgentId: null,
          }
        }
        return persisted as NewChatState
      },
    },
  ),
)
