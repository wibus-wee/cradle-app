import { readObjectRecord } from '../../helpers/json-record'

export const CLAUDE_AGENT_ALIAS_KEYS = ['haiku', 'sonnet', 'opus'] as const

export type ClaudeAgentAliasKey = (typeof CLAUDE_AGENT_ALIAS_KEYS)[number]

export interface ClaudeAgentModelAliases {
  haiku: string
  sonnet: string
  opus: string
}

export interface ClaudeAgentModelAliasesPatch {
  haiku?: string
  sonnet?: string
  opus?: string
}

export interface ClaudeAgentConfigPatchInput {
  modelAliases?: ClaudeAgentModelAliasesPatch
}

export interface ClaudeAgentConfigPatch {
  modelAliases?: ClaudeAgentModelAliases
}

export interface ClaudeAgentConfigView {
  modelAliases: ClaudeAgentModelAliases
}

export const DEFAULT_CLAUDE_AGENT_MODEL_ALIASES: ClaudeAgentModelAliases = {
  haiku: '',
  sonnet: '',
  opus: '',
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function hasClaudeAgentModelAliases(aliases: ClaudeAgentModelAliases | null | undefined): aliases is ClaudeAgentModelAliases {
  return !!aliases && CLAUDE_AGENT_ALIAS_KEYS.some(key => aliases[key].length > 0)
}

export function readClaudeAgentModelAliases(value: unknown): ClaudeAgentModelAliases | null {
  const record = readObjectRecord(value)
  const aliases: ClaudeAgentModelAliases = {
    haiku: readTrimmedString(record.haiku),
    sonnet: readTrimmedString(record.sonnet),
    opus: readTrimmedString(record.opus),
  }
  return hasClaudeAgentModelAliases(aliases) ? aliases : null
}

export function readClaudeAgentConfig(value: unknown): ClaudeAgentConfigView | null {
  const record = readObjectRecord(value)
  const modelAliases = readClaudeAgentModelAliases(record.modelAliases)
  return modelAliases ? { modelAliases } : null
}

export function normalizeClaudeAgentConfigPatch(value: unknown): ClaudeAgentConfigPatch | null {
  if (value === null) {
    return null
  }

  const record = readObjectRecord(value)
  const modelAliases = 'modelAliases' in record
    ? readClaudeAgentModelAliases(record.modelAliases)
    : null
  return modelAliases ? { modelAliases } : null
}

export function applyClaudeAgentConfigPatch(
  config: Record<string, unknown>,
  patch: ClaudeAgentConfigPatch | null,
): Record<string, unknown> {
  const next = { ...config }
  const claudeAgent = { ...readObjectRecord(next.claudeAgent) }

  if (patch?.modelAliases && hasClaudeAgentModelAliases(patch.modelAliases)) {
    claudeAgent.modelAliases = patch.modelAliases
  }
  else {
    delete claudeAgent.modelAliases
  }

  if (Object.keys(claudeAgent).length > 0) {
    next.claudeAgent = claudeAgent
  }
  else {
    delete next.claudeAgent
  }

  return next
}
