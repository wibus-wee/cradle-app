import { Ajv } from 'ajv'
import { z } from 'zod'

import upstreamSchema from './codex-config-schema/config.schema.json'
import manifest from './codex-config-schema/MANIFEST.json'

export const CodexNativeConfigSchema = z.record(z.string(), z.json())
export type CodexNativeConfig = z.infer<typeof CodexNativeConfigSchema>

// These settings already have a Cradle owner or change the runtime's storage/auth boundary.
export const CODEX_MANAGED_CONFIG_KEYS = [
  'model',
  'model_provider',
  'model_providers',
  'model_reasoning_effort',
  'approval_policy',
  'approvals_reviewer',
  'sandbox_mode',
  'sandbox_workspace_write',
  'permissions',
  'default_permissions',
  'mcp_servers',
  'shell_environment_policy',
  'skills',
  'developer_instructions',
  'model_instructions_file',
  'instructions',
  'profile',
  'profiles',
  'projects',
  'cli_auth_credentials_store',
  'mcp_oauth_credentials_store',
  'forced_login_method',
  'forced_chatgpt_workspace_id',
  'chatgpt_base_url',
  'openai_base_url',
  'sqlite_home',
  'log_dir',
] as const

const managedKeys = new Set<string>(CODEX_MANAGED_CONFIG_KEYS)
const editableSchema = {
  ...upstreamSchema,
  properties: Object.fromEntries(
    Object.entries(upstreamSchema.properties).filter(([key]) => !managedKeys.has(key)),
  ),
}
export const CODEX_NATIVE_CONFIG_KEYS = new Set(Object.keys(editableSchema.properties))
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false })
const validate = ajv.compile<CodexNativeConfig>(editableSchema)

export function parseCodexNativeConfig(value: unknown): CodexNativeConfig {
  const config = CodexNativeConfigSchema.parse(value)
  if (!validate(config)) {
    throw new Error(
      validate.errors
        ?.map(
          error =>
            `codex${error.instancePath}${error.params.additionalProperty ? `/${error.params.additionalProperty}` : ''}: ${error.message}`,
        )
        .join('; ') ?? 'Invalid Codex configuration',
    )
  }
  assertTomlValues(config, 'codex')
  return config
}

function assertTomlValues(value: z.infer<ReturnType<typeof z.json>>, path: string): void {
  if (value === null) {
    throw new Error(`${path}: remove the setting to inherit its default; TOML has no null value`)
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertTomlValues(entry, `${path}.${key}`)
    }
  }
}

export function readCodexConfigSchema() {
  return {
    ...manifest,
    schemaJson: JSON.stringify(editableSchema),
    managedKeys: [...CODEX_MANAGED_CONFIG_KEYS],
  }
}
