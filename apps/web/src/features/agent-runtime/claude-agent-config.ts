import { z } from 'zod'

export const CLAUDE_AGENT_ALIAS_KEYS = ['haiku', 'sonnet', 'opus'] as const

export type ClaudeAgentAliasKey = (typeof CLAUDE_AGENT_ALIAS_KEYS)[number]

export interface ClaudeAgentModelAliases {
  haiku: string
  sonnet: string
  opus: string
}

export const DEFAULT_CLAUDE_AGENT_ALIASES: ClaudeAgentModelAliases = {
  haiku: '',
  sonnet: '',
  opus: '',
}

export const DEFAULT_CLAUDE_AGENT_CONFIG = {
  modelAliases: DEFAULT_CLAUDE_AGENT_ALIASES,
}

export const ClaudeAgentModelAliasesSchema = z.object({
  haiku: z.string().default(DEFAULT_CLAUDE_AGENT_ALIASES.haiku),
  sonnet: z.string().default(DEFAULT_CLAUDE_AGENT_ALIASES.sonnet),
  opus: z.string().default(DEFAULT_CLAUDE_AGENT_ALIASES.opus),
})

export const ClaudeAgentConfigSchema = z.object({
  modelAliases: ClaudeAgentModelAliasesSchema.default(DEFAULT_CLAUDE_AGENT_ALIASES),
}).passthrough()

const ConfigRecordSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.record(z.string(), z.unknown()),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(z.record(z.string(), z.unknown()))

function normalizeAliases(aliases: ClaudeAgentModelAliases): ClaudeAgentModelAliases {
  return {
    haiku: aliases.haiku.trim(),
    sonnet: aliases.sonnet.trim(),
    opus: aliases.opus.trim(),
  }
}

export function hasClaudeAgentModelAliases(aliases: ClaudeAgentModelAliases): boolean {
  return CLAUDE_AGENT_ALIAS_KEYS.some(key => aliases[key].trim().length > 0)
}

export function readClaudeAgentModelAliases(
  config: Record<string, unknown> | string | null | undefined,
): ClaudeAgentModelAliases {
  const record = ConfigRecordSchema.parse(config)
  const claudeAgent = ClaudeAgentConfigSchema.parse(record.claudeAgent ?? {})
  return normalizeAliases(claudeAgent.modelAliases)
}

export function writeClaudeAgentModelAliases(
  config: Record<string, unknown>,
  aliases: ClaudeAgentModelAliases,
): Record<string, unknown> {
  const next = { ...config }
  const existingClaudeAgent = ConfigRecordSchema.parse(next.claudeAgent ?? {})
  const modelAliases = normalizeAliases(aliases)

  if (hasClaudeAgentModelAliases(modelAliases)) {
    next.claudeAgent = {
      ...existingClaudeAgent,
      modelAliases,
    }
    return next
  }

  const { modelAliases: _modelAliases, ...claudeAgentRest } = existingClaudeAgent
  if (Object.keys(claudeAgentRest).length > 0) {
    next.claudeAgent = claudeAgentRest
  }
  else {
    delete next.claudeAgent
  }
  return next
}

export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>
