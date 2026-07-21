import type { RuntimeKind } from '../provider-contracts/types'
import type { RuntimeSettings, RuntimeSettingsPatch, RuntimeSettingsSchemaLike } from './runtime-provider-types'

export interface RuntimeSettingsRegistryEntry {
  schema: RuntimeSettingsSchemaLike
  defaults: RuntimeSettings
  normalize: (value: unknown) => RuntimeSettingsPatch
  merge: (base: RuntimeSettings, patch: RuntimeSettingsPatch | null | undefined) => RuntimeSettings
  equals: (left: RuntimeSettings, right: RuntimeSettings) => boolean
  isStaleDefaultPatch: (patch: RuntimeSettingsPatch, sessionSettings: RuntimeSettings) => boolean
}

const CLAUDE_AGENT_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
] as const

export type ClaudeAgentPermissionMode = typeof CLAUDE_AGENT_PERMISSION_MODES[number]

const CODEX_ACCESS_MODES = ['approval-required', 'full-access'] as const
const CODEX_INTERACTION_MODES = ['default', 'plan'] as const

const CLAUDE_AGENT_SETTINGS_SCHEMA: RuntimeSettingsSchemaLike = {
  type: 'object',
  required: ['permissionMode'],
  properties: {
    permissionMode: {
      type: 'string',
      title: 'Permission mode',
      enum: [...CLAUDE_AGENT_PERMISSION_MODES],
      default: 'bypassPermissions',
    },
  },
}

const CODEX_RUNTIME_SETTINGS_SCHEMA: RuntimeSettingsSchemaLike = {
  type: 'object',
  required: ['accessMode', 'interactionMode'],
  properties: {
    accessMode: {
      type: 'string',
      title: 'Access',
      enum: [...CODEX_ACCESS_MODES],
      default: 'full-access',
    },
    interactionMode: {
      type: 'string',
      title: 'Interaction',
      enum: [...CODEX_INTERACTION_MODES],
      default: 'default',
    },
  },
}

const OPENCODE_RUNTIME_SETTINGS_SCHEMA = CODEX_RUNTIME_SETTINGS_SCHEMA

const CLAUDE_AGENT_DEFAULTS: RuntimeSettings = {
  permissionMode: 'bypassPermissions',
}

const CODEX_DEFAULTS: RuntimeSettings = {
  accessMode: 'full-access',
  interactionMode: 'default',
}

function readStringEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : null
}

function createProductSettingsEntry(input: {
  schema: RuntimeSettingsSchemaLike
  defaults: RuntimeSettings
  fields: Array<{
    key: keyof RuntimeSettings & string
    allowed: readonly string[]
  }>
}): RuntimeSettingsRegistryEntry {
  return {
    schema: input.schema,
    defaults: { ...input.defaults },
    normalize(value) {
      const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
      const patch: RuntimeSettingsPatch = {}
      for (const field of input.fields) {
        const normalized = readStringEnum(record[field.key], field.allowed)
        if (normalized) {
          patch[field.key] = normalized
        }
      }
      return patch
    },
    merge(base, patch) {
      const next = { ...base }
      if (!patch) {
        return next
      }
      for (const field of input.fields) {
        const normalized = readStringEnum(patch[field.key], field.allowed)
        if (normalized) {
          next[field.key] = normalized
        }
      }
      return next
    },
    equals(left, right) {
      return input.fields.every(field => left[field.key] === right[field.key])
    },
    isStaleDefaultPatch(patch, sessionSettings) {
      const merged = this.merge({ ...this.defaults }, patch)
      const patchIsDefaultBundle = this.equals(merged, this.defaults)
      const sessionIsNonDefault = !this.equals(sessionSettings, this.defaults)
      return patchIsDefaultBundle && sessionIsNonDefault
    },
  }
}

const RUNTIME_SETTINGS_REGISTRY: Partial<Record<RuntimeKind, RuntimeSettingsRegistryEntry>> = {
  'claude-agent': createProductSettingsEntry({
    schema: CLAUDE_AGENT_SETTINGS_SCHEMA,
    defaults: CLAUDE_AGENT_DEFAULTS,
    fields: [{ key: 'permissionMode', allowed: CLAUDE_AGENT_PERMISSION_MODES }],
  }),
  'codex': createProductSettingsEntry({
    schema: CODEX_RUNTIME_SETTINGS_SCHEMA,
    defaults: CODEX_DEFAULTS,
    fields: [
      { key: 'accessMode', allowed: CODEX_ACCESS_MODES },
      { key: 'interactionMode', allowed: CODEX_INTERACTION_MODES },
    ],
  }),
  'kimi': createProductSettingsEntry({
    schema: CODEX_RUNTIME_SETTINGS_SCHEMA,
    defaults: CODEX_DEFAULTS,
    fields: [
      { key: 'accessMode', allowed: CODEX_ACCESS_MODES },
      { key: 'interactionMode', allowed: CODEX_INTERACTION_MODES },
    ],
  }),
  'opencode': createProductSettingsEntry({
    schema: OPENCODE_RUNTIME_SETTINGS_SCHEMA,
    defaults: CODEX_DEFAULTS,
    fields: [
      { key: 'accessMode', allowed: CODEX_ACCESS_MODES },
      { key: 'interactionMode', allowed: CODEX_INTERACTION_MODES },
    ],
  }),
}

export function runtimeSupportsSessionSettings(runtimeKind: RuntimeKind): boolean {
  return Boolean(RUNTIME_SETTINGS_REGISTRY[runtimeKind])
}

export function readRuntimeSettingsSchema(runtimeKind: RuntimeKind): RuntimeSettingsSchemaLike | null {
  return RUNTIME_SETTINGS_REGISTRY[runtimeKind]?.schema ?? null
}

export function getDefaultRuntimeSettings(runtimeKind: RuntimeKind): RuntimeSettings {
  return { ...(RUNTIME_SETTINGS_REGISTRY[runtimeKind]?.defaults ?? {}) }
}

export function normalizeRuntimeSettingsPatch(
  runtimeKind: RuntimeKind,
  value: unknown,
): RuntimeSettingsPatch {
  return RUNTIME_SETTINGS_REGISTRY[runtimeKind]?.normalize(value) ?? {}
}

export function mergeRuntimeSettings(
  runtimeKind: RuntimeKind,
  base: RuntimeSettings,
  patch?: RuntimeSettingsPatch | null,
): RuntimeSettings {
  const entry = RUNTIME_SETTINGS_REGISTRY[runtimeKind]
  if (!entry) {
    return { ...base }
  }
  return entry.merge(base, patch)
}

export function areRuntimeSettingsEqual(
  runtimeKind: RuntimeKind,
  left: RuntimeSettings,
  right: RuntimeSettings,
): boolean {
  const entry = RUNTIME_SETTINGS_REGISTRY[runtimeKind]
  if (!entry) {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return entry.equals(left, right)
}

export function resolveRunRuntimeSettings(
  runtimeKind: RuntimeKind,
  sessionSettings: RuntimeSettings,
  requestPatch?: RuntimeSettingsPatch | null,
): RuntimeSettings {
  if (!requestPatch) {
    return { ...sessionSettings }
  }
  const entry = RUNTIME_SETTINGS_REGISTRY[runtimeKind]
  if (!entry) {
    return { ...sessionSettings }
  }
  const normalized = entry.normalize(requestPatch)
  if (entry.isStaleDefaultPatch(normalized, sessionSettings)) {
    return { ...sessionSettings }
  }
  return entry.merge(sessionSettings, normalized)
}

export function readCodexLikeRuntimeSettings(
  settings: RuntimeSettings | null | undefined,
): {
  accessMode: 'approval-required' | 'full-access'
  interactionMode: 'default' | 'plan'
} {
  const accessMode = settings?.accessMode === 'approval-required' ? 'approval-required' : 'full-access'
  const interactionMode = settings?.interactionMode === 'plan' ? 'plan' : 'default'
  return { accessMode, interactionMode }
}

/** One-time read migration from pre-provider-native Cradle 2D settings. */
export function migrateLegacyClaudeAgentRuntimeSettings(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const record = value as Record<string, unknown>
  if (readStringEnum(record.permissionMode, CLAUDE_AGENT_PERMISSION_MODES)) {
    return { permissionMode: record.permissionMode }
  }
  if (record.interactionMode === 'plan') {
    return { permissionMode: 'plan' }
  }
  if (record.accessMode === 'approval-required') {
    return { permissionMode: 'default' }
  }
  if (record.accessMode === 'full-access') {
    return { permissionMode: 'bypassPermissions' }
  }
  return value
}

function migrateSessionRuntimeSettingsRaw(
  runtimeKind: RuntimeKind,
  value: unknown,
): unknown {
  if (runtimeKind === 'claude-agent') {
    return migrateLegacyClaudeAgentRuntimeSettings(value)
  }
  return value
}

export function resolveRuntimeSettingsEntry(
  runtimeKind: RuntimeKind,
): RuntimeSettingsRegistryEntry | null {
  return RUNTIME_SETTINGS_REGISTRY[runtimeKind] ?? null
}

export const readRuntimeSettingsDefaults = getDefaultRuntimeSettings

export function readSessionRuntimeSettingsFromConfig(
  runtimeKind: RuntimeKind,
  configJson: string | null | undefined,
): RuntimeSettings {
  const entry = RUNTIME_SETTINGS_REGISTRY[runtimeKind]
  if (!entry) {
    return {}
  }
  let raw: unknown
  try {
    raw = JSON.parse(configJson ?? '{}') as { runtimeSettings?: unknown }
  }
  catch {
    raw = {}
  }
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as { runtimeSettings?: unknown }
    : {}
  const migrated = migrateSessionRuntimeSettingsRaw(runtimeKind, record.runtimeSettings)
  return entry.merge(entry.defaults, entry.normalize(migrated))
}
