import { z } from 'zod'

export const cliTuiLaunchSpecSchema = z.object({
  preset: z.string().trim().min(1).optional(),
  executable: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

export const codexCliSessionBindingSchema = z.object({
  sessionId: z.uuid(),
  capturedAt: z.number().int().positive(),
  startedAt: z.number().int().positive(),
  workspacePath: z.string().trim().min(1),
  sourcePath: z.string().trim().min(1),
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
  /** @deprecated Prefer providerSession; still written for Codex capture compat. */
  codexCliSession: codexCliSessionBindingSchema.optional(),
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
export type CodexCliSessionBinding = z.infer<typeof codexCliSessionBindingSchema>
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
  codexCliSession?: CodexCliSessionBinding | null
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
  if (input.codexCliSession) {
    payload.codexCliSession = input.codexCliSession
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

  // Keep legacy Codex field in sync so older readers still resume.
  if (input.binding.agent === 'codex' && input.binding.kind === 'id') {
    payload.codexCliSession = {
      sessionId: input.binding.value,
      capturedAt: input.binding.capturedAt,
      startedAt: input.binding.startedAt,
      workspacePath: input.binding.workspacePath,
      sourcePath: input.binding.sourcePath ?? input.binding.value,
    } satisfies CodexCliSessionBinding
  }

  return JSON.stringify(payload)
}

export function writeCodexCliSessionBindingToSessionConfig(input: {
  configJson?: string | null
  binding: CodexCliSessionBinding
}): string {
  return writeProviderSessionBindingToSessionConfig({
    configJson: input.configJson,
    binding: {
      source: 'cradle:codex',
      agent: 'codex',
      kind: 'id',
      value: input.binding.sessionId,
      workspacePath: input.binding.workspacePath,
      capturedAt: input.binding.capturedAt,
      startedAt: input.binding.startedAt,
      sourcePath: input.binding.sourcePath,
      confidence: 'exact',
    },
  })
}
