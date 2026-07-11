import { randomUUID } from 'node:crypto'

import type { BackgroundJob } from '@cradle/db'
import { backgroundJobs } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { getOwnerProjector, getSourceAdapter } from './registry'
import type {
  BackgroundJobProjectionResult,
  BackgroundJobSourceObservation,
  BackgroundJobStatus,
  BackgroundJobTerminalStatus,
  BackgroundJobView,
  JsonObject,
} from './types'

const ACTIVE_STATUSES = ['pending', 'running'] as const
const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

export interface EnqueueBackgroundJobInput {
  id?: string
  workspaceId?: string | null
  ownerNamespace: string
  ownerResourceType: string
  ownerResourceId: string
  ownerResourceKey?: string | null
  kind: string
  sourceKind: string
  sourceSessionId?: string | null
  sourceRunId?: string | null
  status?: Extract<BackgroundJobStatus, 'pending' | 'running'>
  attempts?: number
  maxAttempts?: number
  context?: JsonObject
  progress?: JsonObject | null
}

export interface BackgroundJobFilters {
  workspaceId?: string
  ownerNamespace?: string
  ownerResourceType?: string
  ownerResourceId?: string
  ownerResourceKey?: string
  kind?: string
  status?: BackgroundJobStatus
  limit?: number
}

function parseJsonObject(value: string | null): JsonObject | null {
  return value ? (JSON.parse(value) as JsonObject) : null
}

function stringifyJsonObject(value: JsonObject | null | undefined): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value)
}

function toView(row: BackgroundJob): BackgroundJobView {
  return {
    ...row,
    context: parseJsonObject(row.contextJson) ?? {},
    progress: parseJsonObject(row.progressJson),
    result: parseJsonObject(row.resultJson),
    errorDetails: parseJsonObject(row.errorDetailsJson),
  }
}

function buildFilterConditions(filters: BackgroundJobFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters.workspaceId) {
    conditions.push(eq(backgroundJobs.workspaceId, filters.workspaceId))
  }
  if (filters.ownerNamespace) {
    conditions.push(eq(backgroundJobs.ownerNamespace, filters.ownerNamespace))
  }
  if (filters.ownerResourceType) {
    conditions.push(eq(backgroundJobs.ownerResourceType, filters.ownerResourceType))
  }
  if (filters.ownerResourceId) {
    conditions.push(eq(backgroundJobs.ownerResourceId, filters.ownerResourceId))
  }
  if (filters.ownerResourceKey) {
    conditions.push(eq(backgroundJobs.ownerResourceKey, filters.ownerResourceKey))
  }
  if (filters.kind) {
    conditions.push(eq(backgroundJobs.kind, filters.kind))
  }
  if (filters.status) {
    conditions.push(eq(backgroundJobs.status, filters.status))
  }
  return conditions
}

function readRow(id: string): BackgroundJob | undefined {
  return db().select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).get()
}

function requireRow(id: string): BackgroundJob {
  const row = readRow(id)
  if (!row) {
    throw new AppError({
      code: 'background_job_not_found',
      status: 404,
      message: 'Background job not found',
      details: { id },
    })
  }
  return row
}

export function enqueue(input: EnqueueBackgroundJobInput): BackgroundJobView {
  const now = currentUnixSeconds()
  const status = input.status ?? 'pending'
  const row = db()
    .insert(backgroundJobs)
    .values({
      id: input.id ?? randomUUID(),
      workspaceId: input.workspaceId ?? null,
      ownerNamespace: input.ownerNamespace,
      ownerResourceType: input.ownerResourceType,
      ownerResourceId: input.ownerResourceId,
      ownerResourceKey: input.ownerResourceKey ?? null,
      kind: input.kind,
      status,
      sourceKind: input.sourceKind,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceRunId: input.sourceRunId ?? null,
      attempts: input.attempts ?? 1,
      maxAttempts: input.maxAttempts ?? 1,
      contextJson: JSON.stringify(input.context ?? {}),
      progressJson: stringifyJsonObject(input.progress),
      startedAt: status === 'running' ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  return toView(row)
}

export function get(id: string): BackgroundJobView {
  return toView(requireRow(id))
}

export function list(filters: BackgroundJobFilters = {}): BackgroundJobView[] {
  const conditions = buildFilterConditions(filters)
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  return db()
    .select()
    .from(backgroundJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(limit)
    .all()
    .map(toView)
}

export function findActive(input: {
  ownerNamespace: string
  kind: string
  ownerResourceId: string
  ownerResourceKey?: string | null
}): BackgroundJobView | null {
  const conditions: SQL[] = [
    eq(backgroundJobs.ownerNamespace, input.ownerNamespace),
    eq(backgroundJobs.kind, input.kind),
    eq(backgroundJobs.ownerResourceId, input.ownerResourceId),
    inArray(backgroundJobs.status, ACTIVE_STATUSES),
  ]
  if (input.ownerResourceKey !== undefined) {
    conditions.push(
      input.ownerResourceKey === null
        ? isNull(backgroundJobs.ownerResourceKey)
        : eq(backgroundJobs.ownerResourceKey, input.ownerResourceKey),
    )
  }
  const row = db()
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(desc(backgroundJobs.createdAt))
    .get()
  return row ? toView(row) : null
}

function writeSourceObservation(
  row: BackgroundJob,
  observation: BackgroundJobSourceObservation,
): BackgroundJob {
  const now = currentUnixSeconds()
  const terminal = TERMINAL_STATUSES.includes(observation.status as BackgroundJobTerminalStatus)
  db()
    .update(backgroundJobs)
    .set({
      status: observation.status,
      progressJson:
        observation.progress === undefined
          ? row.progressJson
          : stringifyJsonObject(observation.progress),
      resultJson: stringifyJsonObject(observation.result),
      errorCode: observation.errorCode ?? null,
      errorMessage: observation.errorMessage ?? null,
      errorDetailsJson: stringifyJsonObject(observation.errorDetails),
      startedAt:
        observation.startedAt
        ?? row.startedAt
        ?? (observation.status === 'running' || terminal ? now : null),
      finishedAt: terminal ? (observation.finishedAt ?? now) : null,
      projectedAt: terminal ? null : row.projectedAt,
      projectionError: terminal ? null : row.projectionError,
      updatedAt: now,
    })
    .where(and(eq(backgroundJobs.id, row.id), inArray(backgroundJobs.status, ACTIVE_STATUSES)))
    .run()
  return requireRow(row.id)
}

async function projectTerminal(row: BackgroundJob): Promise<void> {
  if (
    row.projectedAt !== null
    || !TERMINAL_STATUSES.includes(row.status as BackgroundJobTerminalStatus)
  ) {
    return
  }
  const projector = getOwnerProjector(row.ownerNamespace, row.kind)
  const now = currentUnixSeconds()
  if (!projector) {
    db()
      .update(backgroundJobs)
      .set({ projectedAt: now, projectionError: null, updatedAt: now })
      .where(and(eq(backgroundJobs.id, row.id), isNull(backgroundJobs.projectedAt)))
      .run()
    return
  }

  try {
    const result = (await projector.project(toView(row))) as BackgroundJobProjectionResult | void
    db()
      .update(backgroundJobs)
      .set({
        status: result?.status ?? row.status,
        resultJson:
          result && 'result' in result ? stringifyJsonObject(result.result) : row.resultJson,
        errorCode: result && 'errorCode' in result ? (result.errorCode ?? null) : row.errorCode,
        errorMessage:
          result && 'errorMessage' in result ? (result.errorMessage ?? null) : row.errorMessage,
        errorDetailsJson:
          result && 'errorDetails' in result
            ? stringifyJsonObject(result.errorDetails)
            : row.errorDetailsJson,
        projectedAt: now,
        projectionAttempts: row.projectionAttempts + 1,
        projectionError: null,
        updatedAt: now,
      })
      .where(and(eq(backgroundJobs.id, row.id), isNull(backgroundJobs.projectedAt)))
      .run()
  }
 catch (error) {
    db()
      .update(backgroundJobs)
      .set({
        projectionAttempts: row.projectionAttempts + 1,
        projectionError: error instanceof Error ? error.message : String(error),
        updatedAt: now,
      })
      .where(and(eq(backgroundJobs.id, row.id), isNull(backgroundJobs.projectedAt)))
      .run()
  }
}

export async function reconcileOne(id: string): Promise<BackgroundJobView> {
  let row = requireRow(id)
  if (ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number])) {
    const adapter = getSourceAdapter(row.sourceKind)
    if (!adapter) {
      row = writeSourceObservation(row, {
        status: 'failed',
        errorCode: 'background_job_source_adapter_missing',
        errorMessage: `No Background Job source adapter is registered for ${row.sourceKind}`,
        finishedAt: currentUnixSeconds(),
      })
    }
 else {
      try {
        row = writeSourceObservation(row, await adapter.read(toView(row)))
      }
 catch (error) {
        const now = currentUnixSeconds()
        db()
          .update(backgroundJobs)
          .set({
            errorCode: 'background_job_source_poll_failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: now,
          })
          .where(
            and(eq(backgroundJobs.id, row.id), inArray(backgroundJobs.status, ACTIVE_STATUSES)),
          )
          .run()
        return get(row.id)
      }
    }
  }
  await projectTerminal(row)
  return get(row.id)
}

export async function reconcile(filters: BackgroundJobFilters = {}): Promise<BackgroundJobView[]> {
  const conditions = buildFilterConditions(filters)
  const outstanding = or(
    inArray(backgroundJobs.status, ACTIVE_STATUSES),
    and(inArray(backgroundJobs.status, TERMINAL_STATUSES), isNull(backgroundJobs.projectedAt)),
  )
  if (outstanding) {
    conditions.push(outstanding)
  }
  const rows = db()
    .select()
    .from(backgroundJobs)
    .where(and(...conditions))
    .orderBy(backgroundJobs.createdAt)
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200))
    .all()

  const results: BackgroundJobView[] = []
  for (const row of rows) {
    results.push(await reconcileOne(row.id))
  }
  return results
}

export async function cancel(id: string): Promise<BackgroundJobView> {
  let row = requireRow(id)
  if (TERMINAL_STATUSES.includes(row.status as BackgroundJobTerminalStatus)) {
    await projectTerminal(row)
    return get(id)
  }

  const now = currentUnixSeconds()
  db()
    .update(backgroundJobs)
    .set({
      status: 'cancelled',
      cancelRequestedAt: row.cancelRequestedAt ?? now,
      finishedAt: now,
      errorCode: null,
      errorMessage: null,
      errorDetailsJson: null,
      projectedAt: null,
      projectionError: null,
      updatedAt: now,
    })
    .where(and(eq(backgroundJobs.id, id), inArray(backgroundJobs.status, ACTIVE_STATUSES)))
    .run()
  row = requireRow(id)

  const adapter = getSourceAdapter(row.sourceKind)
  if (adapter?.cancel) {
    try {
      await adapter.cancel(toView(row))
    }
 catch (error) {
      db()
        .update(backgroundJobs)
        .set({
          errorDetailsJson: JSON.stringify({
            sourceCancelError: error instanceof Error ? error.message : String(error),
          }),
          updatedAt: currentUnixSeconds(),
        })
        .where(eq(backgroundJobs.id, id))
        .run()
      row = requireRow(id)
    }
  }

  await projectTerminal(row)
  return get(id)
}
