import { createHash, randomUUID } from 'node:crypto'

import {
  externalIssueItems,
  externalIssueRepositoryCursors,
  externalIssueSourceBindings,
  externalIssueSources,
  workspaces,
} from '@cradle/db'
import type { ExternalIssueSource, ExternalIssueWarning } from '@cradle/plugin-sdk/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import stringify from 'safe-stable-stringify'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { resolveGitHubToken } from '../../lib/github-api'
import {
  getExternalIssueSource,
  listExternalIssueSources as listRegisteredExternalIssueSources,
} from '../../plugins/external-issue-source-registry'
import { listStatuses } from '../issue/service'

const MIN_REFRESH_INTERVAL_SECONDS = 3600

type Tx = ReturnType<typeof db>

function createExternalIssueSourceSharedConfig(): ReadonlyMap<string, string> {
  const config = new Map<string, string>()
  const token = resolveGitHubToken()
  if (token) {
    config.set('GITHUB_ISSUES_TOKEN', token)
  }
  return config
}

export interface ExternalIssueSourceView {
  id: string
  pluginName: string
  sourceId: string
  label: string
  description: string | null
  enabled: boolean
  registrationStatus: 'registered' | 'unregistered'
  capabilities: Record<string, unknown>
  inventory: Record<string, unknown>
  warnings: ExternalIssueWarning[]
  lastSyncStatus: 'never' | 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified'
  lastSyncMessage: string | null
  lastSyncError: string | null
  lastSyncAt: number | null
  registeredAt: number
}

export interface ExternalIssueSourceBindingView {
  id: string
  workspaceId: string
  sourceKey: string
  repositoryOwner: string
  repositoryName: string
  enabled: boolean
  scheduleEnabled: boolean
  refreshIntervalSeconds: number
  lastRefreshStatus: 'never' | 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified'
  lastRefreshMessage: string | null
  lastRefreshError: string | null
  lastRefreshAt: number | null
  nextRefreshAfter: number | null
  createdAt: number
  updatedAt: number
}

export interface ExternalIssueItemView {
  id: string
  bindingId: string
  workspaceId: string
  statusId: string | null
  sourceKey: string
  externalId: string
  externalKey: string
  externalUrl: string | null
  repositoryOwner: string
  repositoryName: string
  number: number
  title: string
  body: string | null
  sourceState: 'open' | 'closed'
  labels: string[]
  assignees: string[]
  milestone: string | null
  sourceCreatedAt: string | null
  sourceUpdatedAt: string | null
  sourceClosedAt: string | null
  syncStatus: 'active' | 'missing' | 'error'
  fingerprint: string
  metadata: Record<string, unknown>
  warnings: ExternalIssueWarning[]
  lastSeenAt: number
  createdAt: number
  updatedAt: number
}

export interface ExternalIssueRefreshResult {
  sourceKey: string
  bindingId: string
  workspaceId: string
  repositoryOwner: string
  repositoryName: string
  status: 'never' | 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified'
  recordsSeen: number
  recordsProjected: number
  recordsMissing: number
  notModified: boolean
  rateLimitRemaining: number | null
  rateLimitResetAt: number | null
  message?: string
}

const JsonValueSchema = z.json()
const JsonRecordSchema = z.record(z.string(), JsonValueSchema)

const WarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
})

const WarningListSchema = z.array(WarningSchema).default([])

const ExternalIssueSourceCapabilitiesSchema = z.object({
  refresh: z.boolean().optional(),
}).default({})

const RegisteredExternalIssueSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable().default(null),
  capabilities: ExternalIssueSourceCapabilitiesSchema,
})

const ExternalIssueRecordSchema = z.object({
  externalId: z.string(),
  externalKey: z.string(),
  externalUrl: z.string().optional(),
  repository: z.object({
    owner: z.string(),
    name: z.string(),
  }),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  state: z.enum(['open', 'closed']),
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  milestone: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  closedAt: z.string().nullable().optional(),
  metadata: JsonRecordSchema.default({}),
  warnings: WarningListSchema,
})

const ExternalIssueSnapshotSchema = z.object({
  source: z.object({
    status: z.enum(['ok', 'warning', 'error']),
    message: z.string().optional(),
    observedAt: z.string().optional(),
    notModified: z.boolean().optional(),
    etag: z.string().optional(),
    cursor: JsonRecordSchema.optional(),
    rateLimit: z.object({
      remaining: z.number().optional(),
      resetAt: z.number().optional(),
    }).optional(),
  }),
  issues: z.array(ExternalIssueRecordSchema),
  inventory: JsonRecordSchema.default({}),
  warnings: WarningListSchema,
})

type ParsedExternalIssueSnapshot = z.infer<typeof ExternalIssueSnapshotSchema>
type ParsedExternalIssueRecord = z.infer<typeof ExternalIssueRecordSchema>

const JsonRecordTextSchema = z.string().transform(raw => JSON.parse(raw)).pipe(JsonRecordSchema.default({}))
const WarningListTextSchema = z.string().transform(raw => JSON.parse(raw)).pipe(WarningListSchema)
const StringListTextSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.array(z.string()))

const activeRepositoryFetches = new Map<string, Promise<ParsedExternalIssueSnapshot>>()

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function repositoryKey(sourceKey: string, owner: string, name: string): string {
  return `${sourceKey}\0${owner.toLowerCase()}\0${name.toLowerCase()}`
}

function deriveRepositoryCursorId(sourceKey: string, owner: string, name: string): string {
  return `external_issue_repo_${hashText(repositoryKey(sourceKey, owner, name)).slice(0, 24)}`
}

function recordFingerprint(record: ParsedExternalIssueRecord): string {
  return hashText(stringify({
    externalId: record.externalId,
    externalKey: record.externalKey,
    externalUrl: record.externalUrl ?? null,
    repository: record.repository,
    number: record.number,
    title: record.title,
    body: record.body ?? null,
    state: record.state,
    labels: record.labels,
    assignees: record.assignees,
    milestone: record.milestone ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    closedAt: record.closedAt ?? null,
    metadata: record.metadata,
    warnings: record.warnings,
  }) ?? '')
}

function statusFromWarnings(warnings: ExternalIssueWarning[]): 'ok' | 'warning' | 'error' {
  return warnings.some(warning => warning.severity === 'error')
    ? 'error'
    : warnings.length > 0
      ? 'warning'
      : 'ok'
}

function normalizeRepositoryPart(value: string): string {
  return value.trim()
}

function normalizeRefreshInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MIN_REFRESH_INTERVAL_SECONDS
  }
  return Math.max(MIN_REFRESH_INTERVAL_SECONDS, Math.floor(value))
}

function requireWorkspace(workspaceId: string): void {
  const row = db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  if (!row) {
    throw new AppError({ code: 'external_issue_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
}

function defaultStatusId(workspaceId: string): string | null {
  return listStatuses(workspaceId)[0]?.id ?? null
}

function toSourceView(
  row: typeof externalIssueSources.$inferSelect,
  registeredAt: number,
): ExternalIssueSourceView {
  return {
    id: row.id,
    pluginName: row.pluginName,
    sourceId: row.sourceId,
    label: row.label,
    description: row.description,
    enabled: row.enabled,
    registrationStatus: row.registrationStatus,
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
  source: z.infer<typeof RegisteredExternalIssueSourceSchema>
}): ExternalIssueSourceView {
  return {
    id: input.id,
    pluginName: input.pluginName,
    sourceId: input.source.id,
    label: input.source.label,
    description: input.source.description,
    enabled: true,
    registrationStatus: 'registered',
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

function toBindingView(row: typeof externalIssueSourceBindings.$inferSelect): ExternalIssueSourceBindingView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceKey: row.sourceKey,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    enabled: row.enabled,
    scheduleEnabled: row.scheduleEnabled,
    refreshIntervalSeconds: row.refreshIntervalSeconds,
    lastRefreshStatus: row.lastRefreshStatus,
    lastRefreshMessage: row.lastRefreshMessage,
    lastRefreshError: row.lastRefreshError,
    lastRefreshAt: row.lastRefreshAt,
    nextRefreshAfter: row.nextRefreshAfter,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toItemView(row: typeof externalIssueItems.$inferSelect): ExternalIssueItemView {
  return {
    id: row.id,
    bindingId: row.bindingId,
    workspaceId: row.workspaceId,
    statusId: row.statusId,
    sourceKey: row.sourceKey,
    externalId: row.externalId,
    externalKey: row.externalKey,
    externalUrl: row.externalUrl,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    number: row.number,
    title: row.title,
    body: row.body,
    sourceState: row.sourceState,
    labels: StringListTextSchema.parse(row.labelsJson),
    assignees: StringListTextSchema.parse(row.assigneesJson),
    milestone: row.milestone,
    sourceCreatedAt: row.sourceCreatedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    sourceClosedAt: row.sourceClosedAt,
    syncStatus: row.syncStatus,
    fingerprint: row.fingerprint,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    warnings: WarningListTextSchema.parse(row.warningsJson),
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function syncSourceRow(
  database: Tx,
  sourceKey: string,
  owner: string,
  source: z.infer<typeof RegisteredExternalIssueSourceSchema>,
  status: 'never' | 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified',
  input?: {
    inventory?: Record<string, unknown>
    warnings?: ExternalIssueWarning[]
    message?: string | null
    error?: string | null
  },
): void {
  const now = currentUnixSeconds()
  database
    .insert(externalIssueSources)
    .values({
      id: sourceKey,
      pluginName: owner,
      sourceId: source.id,
      label: source.label,
      description: source.description,
      enabled: true,
      registrationStatus: 'registered',
      capabilitiesJson: JSON.stringify(source.capabilities),
      inventoryJson: JSON.stringify(input?.inventory ?? {}),
      warningsJson: JSON.stringify(input?.warnings ?? []),
      lastSyncStatus: status,
      lastSyncMessage: input?.message ?? null,
      lastSyncError: input?.error ?? null,
      lastSyncAt: status === 'never' ? null : now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: externalIssueSources.id,
      set: {
        pluginName: owner,
        sourceId: source.id,
        label: source.label,
        description: source.description,
        enabled: true,
        registrationStatus: 'registered',
        capabilitiesJson: JSON.stringify(source.capabilities),
        inventoryJson: JSON.stringify(input?.inventory ?? {}),
        warningsJson: JSON.stringify(input?.warnings ?? []),
        lastSyncStatus: status,
        lastSyncMessage: input?.message ?? null,
        lastSyncError: input?.error ?? null,
        lastSyncAt: status === 'never' ? null : now,
        updatedAt: now,
      },
    })
    .run()
}

function ensureRegisteredSource(sourceKey: string): {
  owner: string
  source: ExternalIssueSource
  parsed: z.infer<typeof RegisteredExternalIssueSourceSchema>
} {
  const registered = getExternalIssueSource(sourceKey)
  if (!registered) {
    throw new AppError({ code: 'external_issue_source_not_found', status: 404, message: 'External issue source not found', details: { sourceKey } })
  }
  const parsed = RegisteredExternalIssueSourceSchema.parse(registered.source)
  syncSourceRow(db(), sourceKey, registered.owner, parsed, 'never')
  return {
    owner: registered.owner,
    source: registered.source,
    parsed,
  }
}

function upsertRepositoryCursor(
  database: Tx,
  input: {
    sourceKey: string
    repositoryOwner: string
    repositoryName: string
    status: 'never' | 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified'
    etag?: string | null
    cursor?: Record<string, unknown> | null
    message?: string | null
    error?: string | null
    rateLimitRemaining?: number | null
    rateLimitResetAt?: number | null
    nextFetchAfter?: number | null
  },
): typeof externalIssueRepositoryCursors.$inferSelect {
  const now = currentUnixSeconds()
  const id = deriveRepositoryCursorId(input.sourceKey, input.repositoryOwner, input.repositoryName)
  database
    .insert(externalIssueRepositoryCursors)
    .values({
      id,
      sourceKey: input.sourceKey,
      repositoryOwner: input.repositoryOwner,
      repositoryName: input.repositoryName,
      etag: input.etag ?? null,
      cursorJson: JSON.stringify(input.cursor ?? {}),
      lastFetchStatus: input.status,
      lastFetchMessage: input.message ?? null,
      lastFetchError: input.error ?? null,
      lastFetchedAt: input.status === 'never' ? null : now,
      nextFetchAfter: input.nextFetchAfter ?? null,
      rateLimitRemaining: input.rateLimitRemaining ?? null,
      rateLimitResetAt: input.rateLimitResetAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        externalIssueRepositoryCursors.sourceKey,
        externalIssueRepositoryCursors.repositoryOwner,
        externalIssueRepositoryCursors.repositoryName,
      ],
      set: {
        etag: input.etag ?? null,
        cursorJson: JSON.stringify(input.cursor ?? {}),
        lastFetchStatus: input.status,
        lastFetchMessage: input.message ?? null,
        lastFetchError: input.error ?? null,
        lastFetchedAt: input.status === 'never' ? null : now,
        nextFetchAfter: input.nextFetchAfter ?? null,
        rateLimitRemaining: input.rateLimitRemaining ?? null,
        rateLimitResetAt: input.rateLimitResetAt ?? null,
        updatedAt: now,
      },
    })
    .run()
  return database
    .select()
    .from(externalIssueRepositoryCursors)
    .where(eq(externalIssueRepositoryCursors.id, id))
    .get()!
}

function getRepositoryCursor(sourceKey: string, repositoryOwner: string, repositoryName: string): typeof externalIssueRepositoryCursors.$inferSelect | null {
  return db()
    .select()
    .from(externalIssueRepositoryCursors)
    .where(and(
      eq(externalIssueRepositoryCursors.sourceKey, sourceKey),
      eq(externalIssueRepositoryCursors.repositoryOwner, repositoryOwner),
      eq(externalIssueRepositoryCursors.repositoryName, repositoryName),
    ))
    .get() ?? null
}

export function listExternalIssueSources(): ExternalIssueSourceView[] {
  const registered = listRegisteredExternalIssueSources()
  const rows = db().select().from(externalIssueSources).all()
  const byId = new Map(rows.map(row => [row.id, row]))
  const views = registered.map((source) => {
    const parsed = RegisteredExternalIssueSourceSchema.parse(source.source)
    const row = byId.get(source.key)
    if (row) {
      return toSourceView({ ...row, registrationStatus: 'registered' }, source.registeredAt)
    }
    return toRegisteredSourceView({
      id: source.key,
      pluginName: source.owner,
      registeredAt: source.registeredAt,
      source: parsed,
    })
  })
  const registeredKeys = new Set(registered.map(source => source.key))
  for (const row of rows) {
    if (!registeredKeys.has(row.id)) {
      views.push(toSourceView({ ...row, registrationStatus: 'unregistered' }, 0))
    }
  }
  return views.sort((a, b) => a.label.localeCompare(b.label))
}

export function reconcileExternalIssueSourceRegistrations(): void {
  const registeredKeys = new Set(listRegisteredExternalIssueSources().map(source => source.key))
  const rows = db().select({ id: externalIssueSources.id }).from(externalIssueSources).all()
  const unregistered = rows.map(row => row.id).filter(id => !registeredKeys.has(id))
  if (unregistered.length === 0) {
    return
  }
  db()
    .update(externalIssueSources)
    .set({ registrationStatus: 'unregistered', updatedAt: currentUnixSeconds() })
    .where(inArray(externalIssueSources.id, unregistered))
    .run()
}

export function createExternalIssueSourceBinding(input: {
  workspaceId: string
  sourceKey: string
  repositoryOwner: string
  repositoryName: string
  scheduleEnabled?: boolean
  refreshIntervalSeconds?: number
  refreshNow?: boolean
}): ExternalIssueSourceBindingView | Promise<ExternalIssueSourceBindingView> {
  const source = ensureRegisteredSource(input.sourceKey)
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  const repositoryOwner = normalizeRepositoryPart(input.repositoryOwner)
  const repositoryName = normalizeRepositoryPart(input.repositoryName)
  const refreshIntervalSeconds = normalizeRefreshInterval(input.refreshIntervalSeconds)
  const id = randomUUID()
  const row = db().transaction((tx) => {
    syncSourceRow(tx, input.sourceKey, source.owner, source.parsed, 'never')
    tx.insert(externalIssueSourceBindings)
      .values({
        id,
        workspaceId: input.workspaceId,
        sourceKey: input.sourceKey,
        repositoryOwner,
        repositoryName,
        enabled: true,
        scheduleEnabled: input.scheduleEnabled ?? false,
        refreshIntervalSeconds,
        lastRefreshStatus: 'never',
        nextRefreshAfter: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          externalIssueSourceBindings.workspaceId,
          externalIssueSourceBindings.sourceKey,
          externalIssueSourceBindings.repositoryOwner,
          externalIssueSourceBindings.repositoryName,
        ],
        set: {
          enabled: true,
          scheduleEnabled: input.scheduleEnabled ?? false,
          refreshIntervalSeconds,
          updatedAt: now,
        },
      })
      .run()
    return tx.select().from(externalIssueSourceBindings).where(and(
        eq(externalIssueSourceBindings.workspaceId, input.workspaceId),
        eq(externalIssueSourceBindings.sourceKey, input.sourceKey),
        eq(externalIssueSourceBindings.repositoryOwner, repositoryOwner),
        eq(externalIssueSourceBindings.repositoryName, repositoryName),
      )).get()!
  })
  if (input.refreshNow) {
    return refreshExternalIssueSourceBinding(row.id).then(() => toBindingView(
      db().select().from(externalIssueSourceBindings).where(eq(externalIssueSourceBindings.id, row.id)).get() ?? row,
    ))
  }
  return toBindingView(row)
}

export function listExternalIssueSourceBindings(input: { workspaceId?: string, sourceKey?: string } = {}): ExternalIssueSourceBindingView[] {
  const conditions = [
    input.workspaceId ? eq(externalIssueSourceBindings.workspaceId, input.workspaceId) : undefined,
    input.sourceKey ? eq(externalIssueSourceBindings.sourceKey, input.sourceKey) : undefined,
  ].filter(Boolean)
  const query = db().select().from(externalIssueSourceBindings)
  const rows = conditions.length > 0
    ? query.where(and(...conditions)).all()
    : query.all()
  return rows.map(toBindingView)
}

export function deleteExternalIssueSourceBinding(bindingId: string): { ok: true } {
  db().delete(externalIssueSourceBindings).where(eq(externalIssueSourceBindings.id, bindingId)).run()
  return { ok: true }
}

export function updateExternalIssueSourceBinding(bindingId: string, input: {
  enabled?: boolean
  scheduleEnabled?: boolean
  refreshIntervalSeconds?: number
}): ExternalIssueSourceBindingView {
  const binding = db().select().from(externalIssueSourceBindings).where(eq(externalIssueSourceBindings.id, bindingId)).get()
  if (!binding) {
    throw new AppError({ code: 'external_issue_binding_not_found', status: 404, message: 'External issue source binding not found', details: { bindingId } })
  }

  const updated = db().update(externalIssueSourceBindings).set({
      enabled: input.enabled ?? binding.enabled,
      scheduleEnabled: input.scheduleEnabled ?? binding.scheduleEnabled,
      refreshIntervalSeconds: input.refreshIntervalSeconds === undefined
        ? binding.refreshIntervalSeconds
        : normalizeRefreshInterval(input.refreshIntervalSeconds),
      updatedAt: currentUnixSeconds(),
    }).where(eq(externalIssueSourceBindings.id, bindingId)).returning().get()

  return toBindingView(updated)
}

async function fetchRepositorySnapshot(input: {
  sourceKey: string
  source: ExternalIssueSource
  repositoryOwner: string
  repositoryName: string
  force?: boolean
}): Promise<ParsedExternalIssueSnapshot> {
  const key = repositoryKey(input.sourceKey, input.repositoryOwner, input.repositoryName)
  const active = activeRepositoryFetches.get(key)
  if (active) {
    return active
  }
  const promise = Promise.resolve().then(async () => {
    const cursor = getRepositoryCursor(input.sourceKey, input.repositoryOwner, input.repositoryName)
    const now = currentUnixSeconds()
    if (!input.force && cursor?.rateLimitResetAt && cursor.rateLimitResetAt > now) {
      throw new AppError({
        code: 'external_issue_source_rate_limited',
        status: 429,
        message: 'External issue source repository is rate limited',
        details: {
          sourceKey: input.sourceKey,
          repositoryOwner: input.repositoryOwner,
          repositoryName: input.repositoryName,
          rateLimitResetAt: cursor.rateLimitResetAt,
        },
      })
    }
    const snapshot = ExternalIssueSnapshotSchema.parse(await input.source.readSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: createExternalIssueSourceSharedConfig(),
      repository: {
        owner: input.repositoryOwner,
        name: input.repositoryName,
      },
      etag: cursor?.etag ?? null,
      cursor: cursor ? JsonRecordTextSchema.parse(cursor.cursorJson) : null,
    }))
    return snapshot
  })
  activeRepositoryFetches.set(key, promise)
  try {
    return await promise
  }
 finally {
    activeRepositoryFetches.delete(key)
  }
}

function updateBindingRefreshState(
  database: Tx,
  bindingId: string,
  status: 'never' | 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified',
  input: {
    message?: string | null
    error?: string | null
    nextRefreshAfter?: number | null
  } = {},
): void {
  database.update(externalIssueSourceBindings)
    .set({
      lastRefreshStatus: status,
      lastRefreshMessage: input.message ?? null,
      lastRefreshError: input.error ?? null,
      lastRefreshAt: currentUnixSeconds(),
      nextRefreshAfter: input.nextRefreshAfter ?? null,
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(externalIssueSourceBindings.id, bindingId))
    .run()
}

function projectSnapshotToBinding(input: {
  database: Tx
  binding: typeof externalIssueSourceBindings.$inferSelect
  snapshot: ParsedExternalIssueSnapshot
  status: 'ok' | 'warning' | 'error' | 'rate-limited' | 'not-modified'
}): { projected: number, missing: number } {
  const now = currentUnixSeconds()
  const statusError = input.status === 'error'
    ? input.snapshot.source.message ?? input.snapshot.warnings.find(warning => warning.severity === 'error')?.message ?? null
    : null
  if (input.snapshot.source.notModified) {
    updateBindingRefreshState(input.database, input.binding.id, 'not-modified', {
      message: input.snapshot.source.message ?? null,
      nextRefreshAfter: now + input.binding.refreshIntervalSeconds,
    })
    return { projected: 0, missing: 0 }
  }
  const seen = new Set<string>()
  const statusId = input.binding.enabled ? defaultStatusId(input.binding.workspaceId) : null
  for (const record of input.snapshot.issues) {
    const fingerprint = recordFingerprint(record)
    seen.add(record.externalId)
    input.database.insert(externalIssueItems)
      .values({
        id: randomUUID(),
        bindingId: input.binding.id,
        workspaceId: input.binding.workspaceId,
        statusId,
        sourceKey: input.binding.sourceKey,
        externalId: record.externalId,
        externalKey: record.externalKey,
        externalUrl: record.externalUrl ?? null,
        repositoryOwner: record.repository.owner,
        repositoryName: record.repository.name,
        number: record.number,
        title: record.title,
        body: record.body ?? null,
        sourceState: record.state,
        labelsJson: JSON.stringify(record.labels),
        assigneesJson: JSON.stringify(record.assignees),
        milestone: record.milestone ?? null,
        sourceCreatedAt: record.createdAt ?? null,
        sourceUpdatedAt: record.updatedAt ?? null,
        sourceClosedAt: record.closedAt ?? null,
        syncStatus: 'active',
        fingerprint,
        metadataJson: JSON.stringify(record.metadata),
        warningsJson: JSON.stringify(record.warnings),
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          externalIssueItems.workspaceId,
          externalIssueItems.sourceKey,
          externalIssueItems.externalId,
        ],
        set: {
          bindingId: input.binding.id,
          externalKey: record.externalKey,
          externalUrl: record.externalUrl ?? null,
          repositoryOwner: record.repository.owner,
          repositoryName: record.repository.name,
          number: record.number,
          title: record.title,
          body: record.body ?? null,
          sourceState: record.state,
          labelsJson: JSON.stringify(record.labels),
          assigneesJson: JSON.stringify(record.assignees),
          milestone: record.milestone ?? null,
          sourceCreatedAt: record.createdAt ?? null,
          sourceUpdatedAt: record.updatedAt ?? null,
          sourceClosedAt: record.closedAt ?? null,
          syncStatus: 'active',
          fingerprint,
          metadataJson: JSON.stringify(record.metadata),
          warningsJson: JSON.stringify(record.warnings),
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .run()
  }
  const existing = input.database
    .select({ externalId: externalIssueItems.externalId })
    .from(externalIssueItems)
    .where(eq(externalIssueItems.bindingId, input.binding.id))
    .all()
  const missing = existing.map(row => row.externalId).filter(externalId => !seen.has(externalId))
  if (missing.length > 0 && input.snapshot.source.status !== 'error') {
    input.database.update(externalIssueItems)
      .set({ syncStatus: 'missing', updatedAt: now })
      .where(and(
        eq(externalIssueItems.bindingId, input.binding.id),
        inArray(externalIssueItems.externalId, missing),
      ))
      .run()
  }
  updateBindingRefreshState(input.database, input.binding.id, input.status, {
    message: input.snapshot.source.message ?? null,
    error: statusError,
    nextRefreshAfter: now + input.binding.refreshIntervalSeconds,
  })
  return { projected: input.snapshot.issues.length, missing: missing.length }
}

export async function refreshExternalIssueSourceBinding(bindingId: string, input: { force?: boolean } = {}): Promise<ExternalIssueRefreshResult> {
  const binding = db().select().from(externalIssueSourceBindings).where(eq(externalIssueSourceBindings.id, bindingId)).get()
  if (!binding) {
    throw new AppError({ code: 'external_issue_binding_not_found', status: 404, message: 'External issue source binding not found', details: { bindingId } })
  }
  const registered = ensureRegisteredSource(binding.sourceKey)
  const cursorBefore = getRepositoryCursor(binding.sourceKey, binding.repositoryOwner, binding.repositoryName)
  try {
    const snapshot = await fetchRepositorySnapshot({
      sourceKey: binding.sourceKey,
      source: registered.source,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
      force: input.force,
    })
    const status = snapshot.source.notModified
      ? 'not-modified'
      : statusFromWarnings(snapshot.warnings)
    const rateLimitRemaining = snapshot.source.rateLimit?.remaining ?? cursorBefore?.rateLimitRemaining ?? null
    const rateLimitResetAt = snapshot.source.rateLimit?.resetAt ?? cursorBefore?.rateLimitResetAt ?? null
    const nextFetchAfter = rateLimitResetAt && rateLimitRemaining === 0
      ? rateLimitResetAt
      : null
    let projected = 0
    let missing = 0
    db().transaction((tx) => {
      syncSourceRow(tx, binding.sourceKey, registered.owner, registered.parsed, status, {
        inventory: snapshot.inventory,
        warnings: snapshot.warnings,
        message: snapshot.source.message,
      })
      upsertRepositoryCursor(tx, {
        sourceKey: binding.sourceKey,
        repositoryOwner: binding.repositoryOwner,
        repositoryName: binding.repositoryName,
        status,
        etag: snapshot.source.etag ?? cursorBefore?.etag ?? null,
        cursor: snapshot.source.cursor ?? (cursorBefore ? JsonRecordTextSchema.parse(cursorBefore.cursorJson) : {}),
        message: snapshot.source.message ?? null,
        rateLimitRemaining,
        rateLimitResetAt,
        nextFetchAfter,
      })
      const result = projectSnapshotToBinding({ database: tx, binding, snapshot, status })
      projected = result.projected
      missing = result.missing
    })
    return {
      sourceKey: binding.sourceKey,
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
      status,
      recordsSeen: snapshot.issues.length,
      recordsProjected: projected,
      recordsMissing: missing,
      notModified: snapshot.source.notModified ?? false,
      rateLimitRemaining,
      rateLimitResetAt,
      message: snapshot.source.message,
    }
  }
 catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = error instanceof AppError && error.status === 429 ? 'rate-limited' : 'error'
    const resetAt = cursorBefore?.rateLimitResetAt ?? null
    db().transaction((tx) => {
      syncSourceRow(tx, binding.sourceKey, registered.owner, registered.parsed, status, {
        error: message,
      })
      updateBindingRefreshState(tx, binding.id, status, {
        error: message,
        nextRefreshAfter: resetAt,
      })
    })
    if (error instanceof AppError && error.status !== 429) {
      throw error
    }
    return {
      sourceKey: binding.sourceKey,
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      repositoryOwner: binding.repositoryOwner,
      repositoryName: binding.repositoryName,
      status,
      recordsSeen: 0,
      recordsProjected: 0,
      recordsMissing: 0,
      notModified: false,
      rateLimitRemaining: cursorBefore?.rateLimitRemaining ?? null,
      rateLimitResetAt: resetAt,
      message,
    }
  }
}

export async function refreshExternalIssueSource(sourceKey: string, input: { workspaceId: string, force?: boolean }): Promise<ExternalIssueRefreshResult[]> {
  ensureRegisteredSource(sourceKey)
  const bindings = db().select().from(externalIssueSourceBindings).where(and(
      eq(externalIssueSourceBindings.sourceKey, sourceKey),
      eq(externalIssueSourceBindings.workspaceId, input.workspaceId),
      eq(externalIssueSourceBindings.enabled, true),
    )).all()
  const results: ExternalIssueRefreshResult[] = []
  for (const binding of bindings) {
    results.push(await refreshExternalIssueSourceBinding(binding.id, { force: input.force }))
  }
  return results
}

export async function refreshDueExternalIssueSourceBindings(input: { now?: number } = {}): Promise<ExternalIssueRefreshResult[]> {
  const now = input.now ?? currentUnixSeconds()
  const bindings = db()
    .select()
    .from(externalIssueSourceBindings)
    .where(sql`${externalIssueSourceBindings.enabled} = 1 AND ${externalIssueSourceBindings.scheduleEnabled} = 1 AND (${externalIssueSourceBindings.nextRefreshAfter} IS NULL OR ${externalIssueSourceBindings.nextRefreshAfter} <= ${now})`)
    .all()
  const results: ExternalIssueRefreshResult[] = []
  for (const binding of bindings) {
    results.push(await refreshExternalIssueSourceBinding(binding.id))
  }
  return results
}

export function listExternalIssueItems(input: { workspaceId?: string, sourceKey?: string, syncStatus?: 'active' | 'missing' | 'error' } = {}): ExternalIssueItemView[] {
  const conditions = [
    input.workspaceId ? eq(externalIssueItems.workspaceId, input.workspaceId) : undefined,
    input.sourceKey ? eq(externalIssueItems.sourceKey, input.sourceKey) : undefined,
    input.syncStatus ? eq(externalIssueItems.syncStatus, input.syncStatus) : undefined,
  ].filter(Boolean)
  const query = db().select().from(externalIssueItems)
  const rows = conditions.length > 0
    ? query.where(and(...conditions)).all()
    : query.all()
  return rows.map(toItemView)
}

export function updateExternalIssueItemStatus(itemId: string, input: { statusId: string }): ExternalIssueItemView {
  const item = db().select().from(externalIssueItems).where(eq(externalIssueItems.id, itemId)).get()
  if (!item) {
    throw new AppError({ code: 'external_issue_item_not_found', status: 404, message: 'External issue item not found', details: { itemId } })
  }
  const validStatus = listStatuses(item.workspaceId).some(status => status.id === input.statusId)
  if (!validStatus) {
    throw new AppError({ code: 'external_issue_status_not_found', status: 404, message: 'Status not found', details: { workspaceId: item.workspaceId, statusId: input.statusId } })
  }
  const updated = db().update(externalIssueItems).set({ statusId: input.statusId, updatedAt: currentUnixSeconds() }).where(eq(externalIssueItems.id, itemId)).returning().get()
  return toItemView(updated)
}
