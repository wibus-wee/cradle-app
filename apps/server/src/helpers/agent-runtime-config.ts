import { z } from 'zod'

export const cliTuiLaunchSpecSchema = z.object({
  preset: z.string().trim().min(1).optional(),
  executable: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

export const providerSessionBindingSchema = z.object({
  source: z.string().trim().min(1),
  agent: z.string().trim().min(1),
  kind: z.enum(['id', 'path']).default('id'),
  value: z.string().trim().min(1).max(512),
  workspacePath: z.string().trim().min(1),
  capturedAt: z.number().int().positive(),
  startedAt: z.number().int().positive(),
  sourcePath: z.string().trim().min(1).optional(),
  confidence: z.enum(['exact', 'heuristic']).default('exact'),
})

const agentRuntimeConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  cliTui: cliTuiLaunchSpecSchema.optional(),
}).passthrough()

const sessionRuntimeConfigSchema = z.object({
  cliTuiLaunch: cliTuiLaunchSpecSchema.optional(),
  /** Generalized provider conversation binding for CLI TUI resume. */
  providerSession: providerSessionBindingSchema.optional(),
}).passthrough()

export const AgentRuntimeConfigJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(agentRuntimeConfigSchema)

export const SessionRuntimeConfigJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(sessionRuntimeConfigSchema)

export type CliTuiLaunchSpec = z.infer<typeof cliTuiLaunchSpecSchema>
export type ProviderSessionBinding = z.infer<typeof providerSessionBindingSchema>
export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>
export type SessionRuntimeConfig = z.infer<typeof sessionRuntimeConfigSchema>

function readTrustedConfigRecord(raw?: string | null): Record<string, unknown> {
  return raw ? JSON.parse(raw) as Record<string, unknown> : {}
}

export function readTrustedAgentRuntimeConfig(raw?: string | null): AgentRuntimeConfig {
  return readTrustedConfigRecord(raw) as AgentRuntimeConfig
}

export function readTrustedSessionRuntimeConfig(raw?: string | null): SessionRuntimeConfig {
  return readTrustedConfigRecord(raw) as SessionRuntimeConfig
}

export function buildSessionRuntimeConfigJson(input: {
  cliTuiLaunch?: CliTuiLaunchSpec | null
  providerSession?: ProviderSessionBinding | null
}): string {
  const payload: Record<string, unknown> = {}
  if (input.cliTuiLaunch) {
    payload.cliTuiLaunch = {
      executable: input.cliTuiLaunch.executable,
      args: input.cliTuiLaunch.args,
      ...(input.cliTuiLaunch.env ? { env: input.cliTuiLaunch.env } : {}),
      ...(input.cliTuiLaunch.preset ? { preset: input.cliTuiLaunch.preset } : {}),
    }
  }
  if (input.providerSession) {
    payload.providerSession = input.providerSession
  }
  return JSON.stringify(payload)
}

export function writeProviderSessionBindingToSessionConfig(input: {
  configJson?: string | null
  binding: ProviderSessionBinding
}): string {
  const config = readTrustedSessionRuntimeConfig(input.configJson)
  const payload: Record<string, unknown> = {
    ...config,
    providerSession: input.binding,
  }

  return JSON.stringify(payload)
}
