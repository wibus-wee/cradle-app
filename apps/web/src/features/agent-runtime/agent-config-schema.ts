import { z } from 'zod'

import {
  ClaudeAgentConfigSchema,
  ClaudeAgentModelAliasesSchema,
  DEFAULT_CLAUDE_AGENT_CONFIG,
} from './claude-agent-config'

export const CliTuiLaunchConfigSchema = z.object({
  preset: z.string().optional(),
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

export { ClaudeAgentConfigSchema, ClaudeAgentModelAliasesSchema }

export const AgentRuntimeConfigSchema = z.object({
  systemPrompt: z.string().default(''),
  cliTui: CliTuiLaunchConfigSchema.nullable().default(null),
  claudeAgent: ClaudeAgentConfigSchema.default(DEFAULT_CLAUDE_AGENT_CONFIG),
  acpAgentId: z.string().min(1).optional(),
}).passthrough()

export const AgentRuntimeConfigJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(AgentRuntimeConfigSchema)

export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfigSchema>
export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>
