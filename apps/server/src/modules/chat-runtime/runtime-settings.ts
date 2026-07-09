import { parseJsonObject } from '../../helpers/json-record'
import type { ClaudeAgentConfigPatch, ClaudeAgentConfigPatchInput, ClaudeAgentConfigView } from '../provider-contracts/claude-agent-config'
import {
  applyClaudeAgentConfigPatch,
  readClaudeAgentConfig,
} from '../provider-contracts/claude-agent-config'
import type { RuntimeKind } from '../provider-contracts/types'
import type {
  RuntimeSettings,
} from './runtime-provider-types'
import {
  getDefaultRuntimeSettings,
  mergeRuntimeSettings,
  readSessionRuntimeSettingsFromConfig,
} from './runtime-settings-registry'

export {
  areRuntimeSettingsEqual,
  getDefaultRuntimeSettings,
  mergeRuntimeSettings,
  migrateLegacyClaudeAgentRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  readCodexLikeRuntimeSettings,
  readRuntimeSettingsDefaults,
  readRuntimeSettingsSchema,
  resolveRunRuntimeSettings,
  resolveRuntimeSettingsEntry,
  runtimeSupportsSessionSettings,
} from './runtime-settings-registry'

export function readSessionRuntimeSettings(
  runtimeKind: RuntimeKind,
  configJson: string | null | undefined,
): RuntimeSettings {
  return readSessionRuntimeSettingsFromConfig(runtimeKind, configJson)
}

export function readSessionClaudeAgentConfig(configJson: string | null | undefined): ClaudeAgentConfigView | null {
  const config = parseJsonObject(configJson ?? '{}')
  return readClaudeAgentConfig(config.claudeAgent)
}

export function writeSessionRuntimeSettingsConfigJson(
  configJson: string | null | undefined,
  runtimeKind: RuntimeKind,
  settings: RuntimeSettings,
): string {
  const config = parseJsonObject(configJson ?? '{}')
  return JSON.stringify({
    ...config,
    runtimeSettings: mergeRuntimeSettings(runtimeKind, getDefaultRuntimeSettings(runtimeKind), settings),
  })
}

export function writeSessionClaudeAgentConfigJson(
  configJson: string | null | undefined,
  patch: ClaudeAgentConfigPatch | null,
): string {
  const config = parseJsonObject(configJson ?? '{}')
  return JSON.stringify(applyClaudeAgentConfigPatch(config, patch))
}

export function writeSessionRuntimeConfigJson(input: {
  configJson: string | null | undefined
  runtimeKind: RuntimeKind
  runtimeSettings: RuntimeSettings
  claudeAgent?: ClaudeAgentConfigPatch | null
  updateClaudeAgent: boolean
}): string {
  const config = parseJsonObject(input.configJson ?? '{}')
  const withRuntimeSettings = {
    ...config,
    runtimeSettings: mergeRuntimeSettings(
      input.runtimeKind,
      getDefaultRuntimeSettings(input.runtimeKind),
      input.runtimeSettings,
    ),
  }
  const next = input.updateClaudeAgent
    ? applyClaudeAgentConfigPatch(withRuntimeSettings, input.claudeAgent ?? null)
    : withRuntimeSettings
  return JSON.stringify(next)
}

export type {
  ClaudeAgentConfigView as SessionClaudeAgentConfig,
  ClaudeAgentConfigPatch as SessionClaudeAgentConfigPatch,
  ClaudeAgentConfigPatchInput as SessionClaudeAgentConfigPatchInput,
}
