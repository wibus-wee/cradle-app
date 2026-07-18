import { createHash } from 'node:crypto'

import {
  agents,
  externalProviderRecords,
  externalProviderSources,
  providerTargets,
} from '@cradle/db'
import type {
  ExternalProviderSource,
  ExternalProviderSourceReadContext,
  ExternalProviderWarning,
} from '@cradle/plugin-sdk/server'
import { and, eq, inArray } from 'drizzle-orm'
import stringify from 'safe-stable-stringify'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { db } from '../../infra'
import {
  deriveExternalProviderSourceKey,
  getExternalProviderSource,
  listExternalProviderSources as listRegisteredExternalProviderSources,
} from '../../plugins/external-provider-source-registry'
import { matchProviderEndpoint } from '../provider-catalog/provider-endpoint-registry'
import {
  applyClaudeAgentConfigPatch,
  readClaudeAgentConfig,
} from '../provider-contracts/claude-agent-config'
import type { ProviderKind } from '../provider-contracts/types'
import { upsertSecretInDb } from '../secrets/service'

export interface ExternalProviderSourceView {
  id: string
  pluginName: string
  sourceId: string
  label: string
  description: string | null
  enabled: boolean
  capabilities: Record<string, unknown>
  inventory: Record<string, unknown>
  warnings: ExternalProviderWarning[]
  lastSyncStatus: 'never' | 'ok' | 'warning' | 'error'
  lastSyncMessage: string | null
  lastSyncError: string | null
  lastSyncAt: number | null
  registeredAt: number
}

export interface ExternalProviderRecordView {
  id: string
  providerTargetId: string | null
  sourceKey: string
  externalId: string
  app: string
  name: string
  providerKind: ProviderKind | 'cli-tool'
  status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error'
  runtimeTargetEnabled: boolean
  fingerprint: string
  metadata: Record<string, unknown>
  warnings: ExternalProviderWarning[]
  lastSeenAt: number
  createdAt: number
  updatedAt: number
}

export interface ExternalRuntimeTargetView {
  id: string
  sourceKey: string
  externalRecordId: string
  providerKind: 'anthropic' | 'openai-compatible' | 'universal' | 'cli-tool'
  displayName: string
  enabled: boolean
  credentialRef: string | null
  iconSlug: string | null
  lastResolvedFingerprint: string
  createdAt: number
  updatedAt: number
}

export interface ExternalProviderRefreshResult {
  sourceKey: string
  status: 'ok' | 'warning' | 'error'
  recordsSeen: number
  recordsProjected: number
  recordsMissing: number
  message?: string
}

interface RefreshSourceInput {
  owner: string
  source: ExternalProviderSource
  sharedConfig?: ReadonlyMap<string, string>
}

type Tx = ReturnType<typeof db>

const JsonValueSchema = z.json()
const JsonRecordSchema = z.record(z.string(), JsonValueSchema)

const ExternalProviderWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
})

const ExternalProviderWarningsSchema = z.array(ExternalProviderWarningSchema).default([])

const ExternalProviderSourceCapabilitiesSchema = z
  .object({
    refresh: z.boolean().optional(),
    revealSourceFile: z.boolean().optional(),
    importAsNative: z.boolean().optional(),
  })
  .default({})

const ExternalProviderCredentialSchema = z.object({
  kind: z.enum(['api-key', 'chatgpt-auth']),
  value: z.string(),
  label: z.string().optional(),
})

const ExternalProviderRecordKindSchema = z.enum(['anthropic', 'openai-compatible', 'universal', 'cli-tool'])

const ExternalProviderRecordSchema = z.object({
  externalId: z.string(),
  app: z.string(),
  name: z.string(),
  providerKind: ExternalProviderRecordKindSchema,
  config: JsonRecordSchema,
  credential: ExternalProviderCredentialSchema.optional(),
  current: z.boolean().default(false),
  readonly: z.boolean().default(false),
  metadata: JsonRecordSchema.default({}),
  warnings: ExternalProviderWarningsSchema,
})

const RegisteredExternalProviderSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable().default(null),
  capabilities: ExternalProviderSourceCapabilitiesSchema,
})

const ExternalProviderSnapshotSchema = z.object({
  source: z.object({
    status: z.enum(['ok', 'warning', 'error']),
    message: z.string().optional(),
    observedAt: z.string().optional(),
  }),
  providers: z.array(ExternalProviderRecordSchema),
  inventory: JsonRecordSchema.default({}),
  warnings: ExternalProviderWarningsSchema,
})

type ParsedExternalProviderRecord = z.infer<typeof ExternalProviderRecordSchema>

const ExternalProviderRecordFingerprintSchema = z.object({
  app: z.string(),
  name: z.string(),
  providerKind: ExternalProviderRecordKindSchema,
  config: JsonRecordSchema,
  credential: ExternalProviderCredentialSchema.optional(),
  current: z.boolean(),
  readonly: z.boolean(),
  metadata: JsonRecordSchema,
  warnings: ExternalProviderWarningsSchema,
})

const JsonRecordTextSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(JsonRecordSchema.default({}))

const WarningListTextSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(ExternalProviderWarningsSchema)

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function deriveRuntimeTargetId(sourceKey: string, externalId: string): string {
  return `external_provider_target_${hashText(`${sourceKey}\0${externalId}`).slice(0, 24)}`
}

function deriveCredentialId(sourceKey: string, externalId: string): string {
  return `external_credential_${hashText(`${sourceKey}\0${externalId}`).slice(0, 24)}`
}

function recordFingerprint(record: ParsedExternalProviderRecord): string {
  const payload = ExternalProviderRecordFingerprintSchema.parse({
    app: record.app,
    name: record.name,
    providerKind: record.providerKind,
    config: record.config,
    credential: record.credential,
    current: record.current,
    readonly: record.readonly,
    metadata: record.metadata,
    warnings: record.warnings,
  })

  return hashText(stringify(payload))
}

function mergeExternalRecordConfigWithExistingPreferences(
  recordConfig: Record<string, unknown>,
  existingConnectionConfigJson: string | null | undefined,
): Record<string, unknown> {
  if (!existingConnectionConfigJson) {
    return recordConfig
  }

  const existingConfig = parseJsonObjectOrEmpty(existingConnectionConfigJson)
  const existingClaudeAgent = readClaudeAgentConfig(existingConfig.claudeAgent)
  return existingClaudeAgent
    ? applyClaudeAgentConfigPatch(recordConfig, existingClaudeAgent)
    : recordConfig
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isAbsoluteIconUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:'
  }
  catch {
    return false
  }
}

function iconSlugFromMetadata(metadata: Record<string, unknown>): string | null {
  const iconSlug = metadataString(metadata, 'iconSlug')
  if (iconSlug) {
    return iconSlug
  }
  const iconUrl = metadataString(metadata, 'avatarUrl') ?? metadataString(metadata, 'iconUrl')
  if (!iconUrl) {
    return null
  }
  return isAbsoluteIconUrl(iconUrl) ? `url:${encodeURIComponent(iconUrl)}` : iconUrl
}

function sourceIconSlugFromMetadata(record: ParsedExternalProviderRecord): string | null {
  return iconSlugFromMetadata(record.metadata)
}

function recordConfigString(record: ParsedExternalProviderRecord, key: string): string | null {
  const value = record.config[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function bootstrapCustomModelsJson(record: ParsedExternalProviderRecord): string | null {
  if (record.providerKind === 'cli-tool') {
    return null
  }

  const openaiBaseUrl = recordConfigString(record, 'openaiBaseUrl')
  const baseUrl = record.providerKind === 'universal'
    ? openaiBaseUrl
    : recordConfigString(record, 'baseUrl')
  const template = baseUrl
    ? matchProviderEndpoint(
        baseUrl,
        record.providerKind === 'universal' ? 'openai-compatible' : record.providerKind,
      )
    : null
  if (template && template.models.length > 0) {
    return JSON.stringify(template.models.map(model => ({
      id: model.id,
      label: model.label,
    })))
  }

  const defaultModel = recordConfigString(record, 'model') ?? metadataString(record.metadata, 'model')
  return defaultModel
    ? JSON.stringify([{ id: defaultModel, label: defaultModel }])
    : null
}

function sourceStatusFromWarnings(warnings: ExternalProviderWarning[]): 'ok' | 'warning' | 'error' {
  return warnings.some(warning => warning.severity === 'error')
    ? 'error'
    : warnings.length > 0
      ? 'warning'
      : 'ok'
}

function toPersistedSourceView(
  row: typeof externalProviderSources.$inferSelect,
  registeredAt: number,
): ExternalProviderSourceView {
  return {
    id: row.id,
    pluginName: row.pluginName,
    sourceId: row.sourceId,
    label: row.label,
    description: row.description,
    enabled: row.enabled,
    capabilities: JsonRecordTextSchema.parse(row.capabilitiesJson),
    inventory: JsonRecordTextSchema.parse(row.inventoryJson),
    warnings: WarningListTextSchema.parse(row.warningsJson),
    lastSyncStatus: row.lastSyncStatus,
    lastSyncMessage: row.lastSyncMessage,
    lastSyncError: row.lastSyncError,
    lastSyncAt: row.lastSyncAt,
    registeredAt,
  }
}

function toRegisteredSourceView(input: {
  id: string
  pluginName: string
  registeredAt: number
  source: z.infer<typeof RegisteredExternalProviderSourceSchema>
}): ExternalProviderSourceView {
  return {
    id: input.id,
    pluginName: input.pluginName,
    sourceId: input.source.id,
    label: input.source.label,
    description: input.source.description,
    enabled: true,
    capabilities: input.source.capabilities,
    inventory: {},
    warnings: [],
    lastSyncStatus: 'never',
    lastSyncMessage: null,
    lastSyncError: null,
    lastSyncAt: null,
    registeredAt: input.registeredAt,
  }
}

function toRecordView(
  row: typeof externalProviderRecords.$inferSelect,
  target: typeof providerTargets.$inferSelect | null,
): ExternalProviderRecordView {
  return {
    id: row.id,
    providerTargetId: target?.id ?? null,
    sourceKey: row.sourceKey,
    externalId: row.externalId,
    app: row.app,
    name: row.name,
    providerKind: row.providerKind,
    status: row.status,
    runtimeTargetEnabled: target?.enabled ?? false,
    fingerprint: row.fingerprint,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    warnings: WarningListTextSchema.parse(row.warningsJson),
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toRuntimeTargetView(
  row: typeof providerTargets.$inferSelect,
): ExternalRuntimeTargetView {
  return {
    id: row.id,
    sourceKey: row.sourceKey ?? '',
    externalRecordId: row.externalRecordId ?? '',
    providerKind: row.providerKind,
    displayName: row.displayName,
    enabled: row.enabled,
    credentialRef: row.credentialRef,
    iconSlug: row.iconSlug,
    lastResolvedFingerprint: row.sourceFingerprint ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function syncSourceRow(
  database: Tx,
  sourceKey: string,
  owner: string,
  sourceId: string,
  label: string,
  description: string | null,
  capabilities: Record<string, unknown>,
  snapshot: z.infer<typeof ExternalProviderSnapshotSchema>,
  status: 'ok' | 'warning' | 'error',
  message?: string,
  error?: string,
): void {
  const now = nowUnix()
  database
    .insert(externalProviderSources)
    .values({
      id: sourceKey,
      pluginName: owner,
      sourceId,
      label,
      description,
      enabled: true,
      capabilitiesJson: JSON.stringify(capabilities),
      inventoryJson: JSON.stringify(snapshot.inventory),
      warningsJson: JSON.stringify(snapshot.warnings),
      lastSyncStatus: status,
      lastSyncMessage: message ?? snapshot.source.message ?? null,
      lastSyncError: error ?? null,
      lastSyncAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: externalProviderSources.id,
      set: {
        pluginName: owner,
        sourceId,
        label,
        description,
        enabled: true,
        capabilitiesJson: JSON.stringify(capabilities),
        inventoryJson: JSON.stringify(snapshot.inventory),
        warningsJson: JSON.stringify(snapshot.warnings),
        lastSyncStatus: status,
        lastSyncMessage: message ?? snapshot.source.message ?? null,
        lastSyncError: error ?? null,
        lastSyncAt: now,
        updatedAt: now,
      },
    })
    .run()
}

function syncRecordRow(
  database: Tx,
  sourceKey: string,
  record: ParsedExternalProviderRecord,
  status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error',
): string {
  const now = nowUnix()
  const id = deriveRuntimeTargetId(sourceKey, record.externalId)
  database
    .insert(externalProviderRecords)
    .values({
      id,
      sourceKey,
      externalId: record.externalId,
      app: record.app,
      name: record.name,
      providerKind: record.providerKind,
      status,
      fingerprint: recordFingerprint(record),
      metadataJson: JSON.stringify(record.metadata),
      warningsJson: JSON.stringify(record.warnings),
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [externalProviderRecords.sourceKey, externalProviderRecords.externalId],
      set: {
        app: record.app,
        name: record.name,
        providerKind: record.providerKind,
        status,
        fingerprint: recordFingerprint(record),
        metadataJson: JSON.stringify(record.metadata),
        warningsJson: JSON.stringify(record.warnings),
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .run()
  return id
}

function syncRuntimeTarget(
  database: Tx,
  sourceKey: string,
  record: ParsedExternalProviderRecord,
): string | null {
  if (record.providerKind === 'cli-tool') {
    return null
  }
  const id = deriveRuntimeTargetId(sourceKey, record.externalId)
  const existing = database
    .select()
    .from(providerTargets)
    .where(
      and(
        eq(providerTargets.sourceKey, sourceKey),
        eq(providerTargets.externalRecordId, record.externalId),
      ),
    )
    .get()
  const credentialRef = record.credential
    ? upsertSecretInDb(database, {
        id: deriveCredentialId(sourceKey, record.externalId),
        kind: record.credential.kind,
        label: record.credential.label ?? record.name,
        secret: record.credential.value,
      }).id
    : (existing?.credentialRef ?? null)
  const now = nowUnix()
  const sourceIconSlug = sourceIconSlugFromMetadata(record)
  const connectionConfig = mergeExternalRecordConfigWithExistingPreferences(
    record.config,
    existing?.connectionConfigJson,
  )

  const existingCustomModelsJson = existing?.customModelsJson ?? '[]'
  const bootstrappedCustomModelsJson = !existingCustomModelsJson || existingCustomModelsJson === '[]'
    ? bootstrapCustomModelsJson(record)
    : null
  const customModelsJson = bootstrappedCustomModelsJson ?? existingCustomModelsJson

  database
    .insert(providerTargets)
    .values({
      id,
      kind: 'external',
      sourceKey,
      externalRecordId: record.externalId,
      providerKind: record.providerKind,
      displayName: record.name,
      enabled: existing?.enabled ?? true,
      connectionConfigJson: JSON.stringify(connectionConfig),
      credentialRef,
      enabledModelsJson: existing?.enabledModelsJson ?? '[]',
      customModelsJson,
      iconSlug: sourceIconSlug,
      sourceFingerprint: recordFingerprint(record),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [providerTargets.sourceKey, providerTargets.externalRecordId],
      set: {
        providerKind: record.providerKind,
        displayName: record.name,
        connectionConfigJson: JSON.stringify(connectionConfig),
        credentialRef,
        iconSlug: sourceIconSlug,
        sourceFingerprint: recordFingerprint(record),
        ...(bootstrappedCustomModelsJson ? { customModelsJson } : {}),
        updatedAt: now,
      },
    })
    .run()

  return id
}

export function listExternalProviderSources(): ExternalProviderSourceView[] {
  const registered = listRegisteredExternalProviderSources()
  const rows = db().select().from(externalProviderSources).all()
  const byId = new Map(rows.map(row => [row.id, row]))
  const registeredIds = new Set(registered.map(source => source.key))
  const registeredViews = registered.map((source) => {
    const registeredSource = RegisteredExternalProviderSourceSchema.parse(source.source)
    const row = byId.get(source.key)
    if (row) {
      return toPersistedSourceView(row, source.registeredAt)
    }
    return toRegisteredSourceView({
      id: source.key,
      pluginName: source.owner,
      registeredAt: source.registeredAt,
      source: registeredSource,
    })
  })
  const persistedViews = rows
    .filter(row => !registeredIds.has(row.id))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      || a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
    .map(row => toPersistedSourceView(row, row.createdAt))
  return [...registeredViews, ...persistedViews]
}

export function listExternalProviderRecords(): ExternalProviderRecordView[] {
  const runtimeTargets = db().select().from(providerTargets).where(eq(providerTargets.kind, 'external')).all()
  const targetBySourceRecord = new Map(
    runtimeTargets
      .filter(target => target.sourceKey && target.externalRecordId)
      .map(target => [`${target.sourceKey}\0${target.externalRecordId}`, target]),
  )
  return db()
    .select()
    .from(externalProviderRecords)
    .all()
    .map(record =>
      toRecordView(
        record,
        targetBySourceRecord.get(`${record.sourceKey}\0${record.externalId}`) ?? null,
      ))
}

export function getExternalRuntimeTarget(
  sourceKey: string,
  externalRecordId: string,
): ExternalRuntimeTargetView | null {
  const row = db()
    .select()
    .from(providerTargets)
    .where(
      and(
        eq(providerTargets.sourceKey, sourceKey),
        eq(providerTargets.externalRecordId, externalRecordId),
      ),
    )
    .get()
  return row ? toRuntimeTargetView(row) : null
}

export function updateExternalRuntimeTargetEnabled(
  sourceKey: string,
  externalRecordId: string,
  enabled: boolean,
): ExternalRuntimeTargetView | null {
  const now = nowUnix()
  const updated = db().transaction((tx) => {
    const row = tx
      .update(providerTargets)
      .set({ enabled, updatedAt: now })
      .where(
        and(
          eq(providerTargets.sourceKey, sourceKey),
          eq(providerTargets.externalRecordId, externalRecordId),
        ),
      )
      .returning()
      .get()
    if (row && !enabled) {
      tx.update(agents)
        .set({ enabled: false, updatedAt: now })
        .where(eq(agents.providerTargetId, row.id))
        .run()
    }
    return row
  })
  return updated ? toRuntimeTargetView(updated) : null
}

async function refreshSourceSnapshot(
  sourceKey: string,
  owner: string,
  registeredSource: z.infer<typeof RegisteredExternalProviderSourceSchema>,
  source: ExternalProviderSource,
  sharedConfig: ReadonlyMap<string, string>,
): Promise<ExternalProviderRefreshResult> {
  try {
    const readContext: ExternalProviderSourceReadContext = {
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig,
    }
    const snapshot = ExternalProviderSnapshotSchema.parse(
      await source.readSnapshot(readContext),
    )

    const status = sourceStatusFromWarnings(snapshot.warnings)
    const seenRecordIds = new Set<string>()
    let missingCount = 0

    db().transaction((tx) => {
      syncSourceRow(
        tx,
        sourceKey,
        owner,
        registeredSource.id,
        registeredSource.label,
        registeredSource.description,
        registeredSource.capabilities,
        snapshot,
        status,
        snapshot.source.message,
      )

      for (const record of snapshot.providers) {
        const recordStatus = record.readonly ? 'unsupported' : 'active'
        syncRecordRow(tx, sourceKey, record, recordStatus)
        syncRuntimeTarget(tx, sourceKey, record)
        seenRecordIds.add(record.externalId)
      }

      const existing = tx
        .select({ externalId: externalProviderRecords.externalId })
        .from(externalProviderRecords)
        .where(eq(externalProviderRecords.sourceKey, sourceKey))
        .all()

      const missing = existing
        .filter(row => !seenRecordIds.has(row.externalId))
        .map(row => row.externalId)
      missingCount = missing.length
      if (missing.length > 0) {
        const missingTargetIds = missing.map(externalId =>
          deriveRuntimeTargetId(sourceKey, externalId))
        tx.update(externalProviderRecords)
          .set({ status: 'missing', updatedAt: nowUnix() })
          .where(
            and(
              eq(externalProviderRecords.sourceKey, sourceKey),
              inArray(externalProviderRecords.externalId, missing),
            ),
          )
          .run()
        tx.update(providerTargets)
          .set({ enabled: false, updatedAt: nowUnix() })
          .where(inArray(providerTargets.id, missingTargetIds))
          .run()
        tx.update(agents)
          .set({ enabled: false, updatedAt: nowUnix() })
          .where(inArray(agents.providerTargetId, missingTargetIds))
          .run()
      }
    })

    return {
      sourceKey,
      status,
      recordsSeen: snapshot.providers.length,
      recordsProjected: snapshot.providers.length,
      recordsMissing: missingCount,
      message: snapshot.source.message,
    }
  }
 catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const now = nowUnix()
    db()
      .insert(externalProviderSources)
      .values({
        id: sourceKey,
        pluginName: owner,
        sourceId: registeredSource.id,
        label: registeredSource.label,
        description: registeredSource.description,
        enabled: true,
        capabilitiesJson: JSON.stringify(registeredSource.capabilities),
        inventoryJson: '{}',
        warningsJson: '[]',
        lastSyncStatus: 'error',
        lastSyncMessage: null,
        lastSyncError: message,
        lastSyncAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: externalProviderSources.id,
        set: {
          lastSyncStatus: 'error',
          lastSyncMessage: null,
          lastSyncError: message,
          lastSyncAt: now,
          updatedAt: now,
        },
      })
      .run()

    return {
      sourceKey,
      status: 'error',
      recordsSeen: 0,
      recordsProjected: 0,
      recordsMissing: 0,
      message,
    }
  }
}

export async function refreshDirectExternalProviderSource(
  input: RefreshSourceInput,
): Promise<ExternalProviderRefreshResult> {
  const registeredSource = RegisteredExternalProviderSourceSchema.parse(input.source)
  return refreshSourceSnapshot(
    deriveExternalProviderSourceKey(input.owner, registeredSource.id),
    input.owner,
    registeredSource,
    input.source,
    input.sharedConfig ?? new Map(),
  )
}

export async function refreshExternalProviderSource(
  sourceKey: string,
): Promise<ExternalProviderRefreshResult> {
  const registered = getExternalProviderSource(sourceKey)
  if (!registered) {
    throw new AppError({
      code: 'external_source_not_found',
      status: 404,
      message: 'External provider source not found',
      details: { sourceKey },
    })
  }
  const registeredSource = RegisteredExternalProviderSourceSchema.parse(registered.source)

  return refreshSourceSnapshot(
    sourceKey,
    registered.owner,
    registeredSource,
    registered.source,
    new Map(),
  )
}

export async function refreshAllExternalProviderSources(): Promise<
  ExternalProviderRefreshResult[]
> {
  const results: ExternalProviderRefreshResult[] = []
  for (const source of listRegisteredExternalProviderSources()) {
    results.push(await refreshExternalProviderSource(source.key))
  }
  return results
}
