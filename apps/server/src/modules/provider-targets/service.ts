import { randomUUID } from 'node:crypto'

import type { ProviderTarget as ProviderTargetRow } from '@cradle/db'
import {
  agentCredentials,
  agents,
  agentSessions,
  backendCapabilitySnapshots,
  externalProviderRecords,
  providerTargetModelCache,
  providerTargets,
  runtimeAuditLog,
  sessions,
  usageLogs,
} from '@cradle/db'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { clearProviderTargetFromSessionQueuesInTransaction } from '../chat-runtime/es/commands'
import { publishSessionTailEvents } from '../chat-runtime/es/event-tail'
import {
  CODEX_BEDROCK_API_KEY_SECRET_KIND,
  CODEX_CHATGPT_AUTH_SECRET_KIND,
  CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND,
} from '../chat-runtime-providers/codex/app-server/chatgpt-auth'
import type { ClaudeAgentConfigPatch } from '../provider-contracts/claude-agent-config'
import {
  applyClaudeAgentConfigPatch,
  normalizeClaudeAgentConfigPatch,
} from '../provider-contracts/claude-agent-config'
import { CodexAuthModeSchema, readTrustedUniversalConfig } from '../provider-contracts/provider-base'
import {
  listRuntimeOwnedProviderTargets,
  projectRuntimeOwnedProviderTarget,
  readRuntimeOwnedProviderTargetOwner,
  readRuntimeProviderBinding,
  readRuntimeUniversalProviderKind,
  runtimeOwnsProviderBinding,
  runtimeSupportsProviderKind,
} from '../provider-contracts/runtime-compatibility'
import type { ModelCapabilities, ProviderKind, RuntimeKind } from '../provider-contracts/types'
import {
  releaseLiveProviderRuntimeSessionsForProviderTarget,
  unlinkProviderTargetFromDurableProviderRuntimeBindings,
} from '../provider-runtime/service'
import * as Workspace from '../workspace/service'

const ProviderTargetRefSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(['manual', 'external']).optional(),
})

export type ProviderTarget = z.infer<typeof ProviderTargetRefSchema>

export interface UpsertManualProviderTargetInput {
  id?: string
  displayName: string
  providerKind: ProviderKind
  enabled?: boolean
  connectionConfigJson: string
  credentialRef?: string | null
  iconSlug?: string | null
}

export interface ListProviderTargetsInput {
  runtimeKind?: RuntimeKind
  workspaceId?: string | null
}

export interface ResolvedProviderTarget {
  target: {
    id: string
    kind: 'manual' | 'external'
  }
  id: string
  kind: 'manual' | 'external'
  label: string
  providerKind: ProviderKind
  enabled: boolean
  connectionConfigJson: string
  configJson: string
  credentialRef: string | null
  enabledModelsJson: string
  customModelsJson: string
  iconSlug: string | null
  sourceMetadata: {
    sourceKey: string
    externalRecordId: string
    app: string
  } | null
}

export interface ProviderTargetModelSettings {
  providerTargetId: string
  configJson: string
  connectionConfigJson: string
  enabledModelsJson: string
  customModelsJson: string
  providerTargetKind?: 'manual' | 'external'
}

export interface CustomModelEntry {
  id: string
  label: string
  capabilities: ModelCapabilities
}

const JsonObjectTextSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()).default({}))

const EnabledModelsJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.string().min(1)).default([]))

const CustomModelInputSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().optional(),
})

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function parseTargetId(input: ProviderTarget | string): string {
  if (typeof input === 'string') {
    return z.string().trim().min(1).parse(input)
  }
  return ProviderTargetRefSchema.parse(input).id
}

function mergeConnectionConfigWithEnabledModels(
  connectionConfigJson: string,
  enabledModelsJson: string,
): string {
  const config = JsonObjectTextSchema.parse(connectionConfigJson)
  const enabledModels = EnabledModelsJsonSchema.parse(enabledModelsJson)
  return JSON.stringify({
    ...config,
    enabledModels,
  })
}

function normalizeManualConnectionConfig(input: UpsertManualProviderTargetInput): string {
  if (input.providerKind !== 'openai-compatible') {
    return input.connectionConfigJson
  }

  const config = JsonObjectTextSchema.parse(input.connectionConfigJson)
  const credentialAuthMode = resolveCredentialAuthMode(input.credentialRef ?? null)
  const storedAuthMode = CodexAuthModeSchema.safeParse(config.authMode)
  const inlineApiKey = typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
  const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim().length > 0
  const authMode = credentialAuthMode
    ?? (storedAuthMode.success ? storedAuthMode.data : null)
    ?? (inlineApiKey || baseUrl ? 'apikey' : null)

  return JSON.stringify({
    ...config,
    ...(authMode ? { authMode } : {}),
  })
}

function resolveCredentialAuthMode(credentialRef: string | null): z.infer<typeof CodexAuthModeSchema> | null {
  if (!credentialRef) {
    return null
  }
  const credential = db()
    .select({ kind: agentCredentials.kind })
    .from(agentCredentials)
    .where(eq(agentCredentials.id, credentialRef))
    .get()
  if (!credential) {
    return null
  }
  switch (credential.kind) {
    case CODEX_CHATGPT_AUTH_SECRET_KIND:
      return 'chatgptAuthTokens'
    case CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND:
      return 'personalAccessToken'
    case CODEX_BEDROCK_API_KEY_SECRET_KIND:
      return 'bedrockApiKey'
    default:
      return 'apikey'
  }
}

function assertChatgptCredentialProviderInvariant(input: UpsertManualProviderTargetInput): void {
  if (resolveCredentialAuthMode(input.credentialRef ?? null) !== 'chatgptAuthTokens') {
    return
  }
  if (input.providerKind !== 'openai-compatible') {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'ChatGPT login credentials can only be used by OpenAI-compatible provider targets',
      details: { providerKind: input.providerKind },
    })
  }
  const config = JsonObjectTextSchema.parse(input.connectionConfigJson)
  const storedAuthMode = CodexAuthModeSchema.safeParse(config.authMode)
  if (storedAuthMode.success && storedAuthMode.data !== 'chatgptAuthTokens') {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'ChatGPT login authentication mode cannot be changed',
      details: { authMode: storedAuthMode.data },
    })
  }
}

function toResolvedProviderTarget(row: ProviderTargetRow): ResolvedProviderTarget {
  const sourceMetadata
    = row.kind === 'external' && row.sourceKey && row.externalRecordId
      ? (() => {
          const record = db()
            .select()
            .from(externalProviderRecords)
            .where(
              and(
                eq(externalProviderRecords.sourceKey, row.sourceKey),
                eq(externalProviderRecords.externalId, row.externalRecordId),
              ),
            )
            .get()
          return {
            sourceKey: row.sourceKey,
            externalRecordId: row.externalRecordId,
            app: record?.app ?? 'external',
          }
        })()
      : null

  return {
    target: {
      id: row.id,
      kind: row.kind,
    },
    id: row.id,
    kind: row.kind,
    label: row.displayName,
    providerKind: row.providerKind,
    enabled: row.enabled,
    connectionConfigJson: row.connectionConfigJson,
    configJson: mergeConnectionConfigWithEnabledModels(
      row.connectionConfigJson,
      row.enabledModelsJson,
    ),
    credentialRef: row.credentialRef ?? null,
    enabledModelsJson: row.enabledModelsJson,
    customModelsJson: row.customModelsJson,
    iconSlug: row.iconSlug ?? null,
    sourceMetadata,
  }
}

type ProviderTargetWriteDb = Pick<ReturnType<typeof db>, 'update'>

function disableAgentsForProviderTargetInDb(providerTargetId: string, d: ProviderTargetWriteDb): void {
  d.update(agents)
    .set({
      enabled: false,
      updatedAt: nowUnix(),
    })
    .where(eq(agents.providerTargetId, providerTargetId))
    .run()
}

export function providerTargetFromLegacyProfileId(
  profileId: string | null | undefined,
): ProviderTarget | null {
  if (!profileId) {
    return null
  }
  return { id: profileId, kind: 'manual' }
}

export function providerTargetCacheId(target: ProviderTarget | string): string {
  return parseTargetId(target)
}

export function listStoredProviderTargets(): ProviderTargetRow[] {
  return db().select().from(providerTargets).all()
}

export async function listProviderTargets(input: ListProviderTargetsInput = {}): Promise<ProviderTargetRow[]> {
  const rows = listStoredProviderTargets()
  if (!input.runtimeKind) {
    return rows
  }
  const workspacePath = input.workspaceId ? Workspace.getLocalWorkspacePath(input.workspaceId) ?? undefined : undefined
  const runtimeOwnedTargets = await listRuntimeOwnedProviderTargets({
    runtimeKind: input.runtimeKind,
    workspacePath,
    now: nowUnix(),
  })
  return runtimeOwnsProviderBinding(input.runtimeKind)
    ? runtimeOwnedTargets
    : [...rows, ...runtimeOwnedTargets]
}

export function getProviderTarget(id: string): ProviderTargetRow | null {
  const runtimeOwnedTarget = projectRuntimeOwnedProviderTarget({ providerTargetId: id, now: nowUnix() })
  if (runtimeOwnedTarget) {
    return runtimeOwnedTarget
  }
  return db().select().from(providerTargets).where(eq(providerTargets.id, id)).get() ?? null
}

export function resolveProviderTarget(input: ProviderTarget | string): ResolvedProviderTarget {
  const id = parseTargetId(input)
  const row = getProviderTarget(id)
  if (!row) {
    throw new AppError({
      code: 'provider_target_not_found',
      status: 404,
      message: 'Provider target not found',
      details: { providerTargetId: id },
    })
  }
  return toResolvedProviderTarget(row)
}

function projectUniversalProviderTargetForRuntime(
  target: ResolvedProviderTarget,
  runtimeKind: RuntimeKind,
): ResolvedProviderTarget {
  const providerKind = readRuntimeUniversalProviderKind(runtimeKind)
  if (!providerKind) {
    return target
  }

  const config = JsonObjectTextSchema.parse(target.configJson)
  const universalConfig = readTrustedUniversalConfig(target.configJson)
  const baseUrl = providerKind === 'anthropic'
    ? universalConfig.anthropicBaseUrl
    : universalConfig.openaiBaseUrl

  return {
    ...target,
    providerKind,
    configJson: JSON.stringify({
      ...config,
      ...(baseUrl ? { baseUrl } : {}),
    }),
  }
}

export function resolveProviderTargetForRuntime(
  input: ProviderTarget | string,
  runtimeKind: RuntimeKind,
): ResolvedProviderTarget {
  const target = resolveProviderTarget(input)
  if (target.providerKind !== 'universal') {
    return target
  }
  return projectUniversalProviderTargetForRuntime(target, runtimeKind)
}

export function upsertManualProviderTarget(
  input: UpsertManualProviderTargetInput,
): ProviderTargetRow {
  const id = input.id?.trim() || randomUUID()
  const now = nowUnix()
  const existing = getProviderTarget(id)
  const providerKindChanged = !!existing && existing.providerKind !== input.providerKind
  if (existing && existing.kind !== 'manual') {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'External provider targets cannot be overwritten as manual targets',
      details: { providerTargetId: id },
    })
  }
  assertChatgptCredentialProviderInvariant(input)

  const nextEnabled = input.enabled ?? existing?.enabled ?? true
  const connectionConfigJson = normalizeManualConnectionConfig(input)
  const enabledModelsJson = providerKindChanged ? '[]' : (existing?.enabledModelsJson ?? '[]')
  const d = db()
  d.transaction((tx) => {
    tx.insert(providerTargets)
      .values({
        id,
        kind: 'manual',
        providerKind: input.providerKind,
        displayName: input.displayName,
        enabled: nextEnabled,
        connectionConfigJson,
        credentialRef: input.credentialRef ?? null,
        iconSlug: input.iconSlug ?? null,
        enabledModelsJson,
        customModelsJson: existing?.customModelsJson ?? '[]',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: providerTargets.id,
        set: {
          providerKind: input.providerKind,
          displayName: input.displayName,
          enabled: nextEnabled,
          connectionConfigJson,
          credentialRef: input.credentialRef ?? null,
          ...(input.iconSlug !== undefined ? { iconSlug: input.iconSlug } : {}),
          ...(providerKindChanged ? { enabledModelsJson } : {}),
          updatedAt: now,
        },
      })
      .run()
    if (providerKindChanged) {
      unlinkProviderTargetFromDurableProviderRuntimeBindings({
        providerTargetId: id,
        writer: tx,
      })
      tx.delete(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, id)).run()
      tx.delete(agentSessions).where(eq(agentSessions.providerTargetId, id)).run()
    }
    else if (
      existing
      && (
        existing.connectionConfigJson !== connectionConfigJson
        || existing.credentialRef !== (input.credentialRef ?? null)
      )
    ) {
      // Connection/credential changes invalidate inventory — upstream model list may differ.
      tx.delete(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, id)).run()
    }
    if (!nextEnabled) {
      disableAgentsForProviderTargetInDb(id, tx)
    }
  })
  if (providerKindChanged) {
    releaseLiveProviderRuntimeSessionsForProviderTarget(id)
  }

  return getProviderTarget(id)!
}

export function updateProviderTargetIcon(
  providerTargetId: string,
  iconSlug: string | null,
): ProviderTargetRow {
  const target = resolveProviderTarget(providerTargetId)
  db()
    .update(providerTargets)
    .set({ iconSlug, updatedAt: nowUnix() })
    .where(eq(providerTargets.id, target.id))
    .run()
  return getProviderTarget(target.id)!
}

export function updateProviderTargetEnabled(
  providerTargetId: string,
  enabled: boolean,
): ProviderTargetRow {
  const target = resolveProviderTarget(providerTargetId)
  const d = db()
  d.transaction((tx) => {
    tx.update(providerTargets)
      .set({ enabled, updatedAt: nowUnix() })
      .where(eq(providerTargets.id, target.id))
      .run()
    if (!enabled) {
      disableAgentsForProviderTargetInDb(target.id, tx)
    }
  })
  return getProviderTarget(target.id)!
}

export function removeProviderTarget(providerTargetId: string): void {
  const target = resolveProviderTarget(providerTargetId)
  const d = db()
  const storedSessionEvents = d.transaction((tx) => {
    const now = nowUnix()
    const ownedAgentIds = tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.providerTargetId, target.id))
      .all()
      .map(row => row.id)

    tx.update(sessions)
      .set({ providerTargetId: null, updatedAt: now })
      .where(eq(sessions.providerTargetId, target.id))
      .run()
    unlinkProviderTargetFromDurableProviderRuntimeBindings({
      providerTargetId: target.id,
      writer: tx,
    })
    tx.update(backendCapabilitySnapshots)
      .set({ providerTargetId: null })
      .where(eq(backendCapabilitySnapshots.providerTargetId, target.id))
      .run()
    tx.update(runtimeAuditLog)
      .set({ providerTargetId: null })
      .where(eq(runtimeAuditLog.providerTargetId, target.id))
      .run()
    tx.update(usageLogs)
      .set({ providerTargetId: null })
      .where(eq(usageLogs.providerTargetId, target.id))
      .run()
    const queueEvents = clearProviderTargetFromSessionQueuesInTransaction(tx, {
      providerTargetId: target.id,
      updatedAt: now,
    })
    tx.delete(providerTargetModelCache).where(eq(providerTargetModelCache.providerTargetId, target.id)).run()
    tx.delete(agentSessions).where(eq(agentSessions.providerTargetId, target.id)).run()
    if (ownedAgentIds.length > 0) {
      tx.update(agents)
        .set({
          providerTargetId: null,
          enabled: false,
          updatedAt: now,
        })
        .where(inArray(agents.id, ownedAgentIds))
        .run()
    }
    tx.delete(providerTargets).where(eq(providerTargets.id, target.id)).run()
    return queueEvents
  })
  publishSessionTailEvents(storedSessionEvents)
  releaseLiveProviderRuntimeSessionsForProviderTarget(target.id)
}

export function assertProviderTargetCompatibleWithRuntime(
  target: ProviderTarget | string,
  runtimeKind: RuntimeKind,
): void {
  const providerTargetId = parseTargetId(target)
  const owningRuntimeKind = readRuntimeOwnedProviderTargetOwner(providerTargetId)
  if (owningRuntimeKind) {
    if (owningRuntimeKind === runtimeKind) {
      return
    }
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'Runtime-owned provider target is not compatible with the selected runtime',
      details: {
        providerTargetId,
        runtimeKind,
        owningRuntimeKind,
      },
    })
  }
  if (readRuntimeProviderBinding(runtimeKind) === 'none') {
    // Binding-'none' runtimes never bind to a provider; a stored target only carries legacy
    // launch configuration, so no provider-kind compatibility applies.
    return
  }
  if (runtimeOwnsProviderBinding(runtimeKind)) {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'Runtime only supports runtime-owned provider targets',
      details: {
        providerTargetId,
        runtimeKind,
      },
    })
  }
  const resolved = resolveProviderTargetForRuntime(target, runtimeKind)
  if (!runtimeSupportsProviderKind(runtimeKind, resolved.providerKind)) {
    throw new AppError({
      code: 'invalid_provider_target',
      status: 400,
      message: 'Provider target is not compatible with the selected runtime',
      details: {
        providerTargetId: resolved.id,
        runtimeKind,
        providerKind: resolved.providerKind,
      },
    })
  }
}

export function getProviderTargetModelSettings(
  input: ProviderTarget | string,
): ProviderTargetModelSettings {
  const resolved = resolveProviderTarget(input)
  return {
    providerTargetId: resolved.id,
    providerTargetKind: resolved.kind,
    configJson: resolved.configJson,
    connectionConfigJson: resolved.connectionConfigJson,
    enabledModelsJson: resolved.enabledModelsJson,
    customModelsJson: resolved.customModelsJson,
  }
}

export function updateProviderTargetModelVisibility(
  input: ProviderTarget | string,
  enabledModels: string[],
): ProviderTargetModelSettings {
  const providerTargetId = parseTargetId(input)
  resolveProviderTarget(providerTargetId)
  const enabledModelsJson = JSON.stringify(z.array(z.string().trim().min(1)).parse(enabledModels))
  db()
    .update(providerTargets)
    .set({
      enabledModelsJson,
      updatedAt: nowUnix(),
    })
    .where(eq(providerTargets.id, providerTargetId))
    .run()

  return getProviderTargetModelSettings(providerTargetId)
}

export function updateProviderTargetClaudeAgentConfig(
  input: ProviderTarget | string,
  patch: ClaudeAgentConfigPatch | null,
): ProviderTargetModelSettings {
  const providerTargetId = parseTargetId(input)
  const target = resolveProviderTarget(providerTargetId)
  const connectionConfig = JsonObjectTextSchema.parse(target.connectionConfigJson)
  const nextConnectionConfig = applyClaudeAgentConfigPatch(connectionConfig, patch)

  db()
    .update(providerTargets)
    .set({
      connectionConfigJson: JSON.stringify(nextConnectionConfig),
      updatedAt: nowUnix(),
    })
    .where(eq(providerTargets.id, providerTargetId))
    .run()

  return getProviderTargetModelSettings(providerTargetId)
}

export function updateProviderTargetClaudeAgentConfigFromJson(
  input: ProviderTarget | string,
  value: unknown,
): ProviderTargetModelSettings {
  return updateProviderTargetClaudeAgentConfig(input, normalizeClaudeAgentConfigPatch(value))
}

export async function updateProviderTargetCustomModels(
  input: ProviderTarget | string,
  models: Array<{ id: string, label?: string }>,
): Promise<CustomModelEntry[]> {
  const providerTargetId = parseTargetId(input)
  resolveProviderTarget(providerTargetId)
  const parsedModels = z.array(CustomModelInputSchema).parse(models)
  const entries: CustomModelEntry[] = parsedModels.map(model => ({
    id: model.id,
    label: model.label ?? model.id,
    capabilities: {},
  }))

  db()
    .update(providerTargets)
    .set({
      customModelsJson: JSON.stringify(entries.map(({ id, label }) => ({ id, label }))),
      updatedAt: nowUnix(),
    })
    .where(eq(providerTargets.id, providerTargetId))
    .run()

  return entries
}
