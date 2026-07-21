import { createReadStream, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { createInterface } from 'node:readline'

import { backendSessionBindings, usageLogs } from '@cradle/db'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../../infra'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import * as Observability from '../../observability/service'
import type { RuntimeUsageEventContext } from '../../usage/ingest'
import { recordRuntimeUsageEvent, replaceLegacyRuntimeUsage } from '../../usage/ingest'
import { CodexAppServerClient, resolveCodexAppServerHome } from './app-server/client'
import type { Thread } from './app-server-protocol/v2/Thread'
import type { ThreadListParams } from './app-server-protocol/v2/ThreadListParams'
import type { ThreadListResponse } from './app-server-protocol/v2/ThreadListResponse'
import type { ThreadReadResponse } from './app-server-protocol/v2/ThreadReadResponse'
import type { TokenUsageBreakdown } from './app-server-protocol/v2/TokenUsageBreakdown'
import type { CodexAppServerClientLike } from './types'
import { createCodexRuntimeUsageEvent } from './usage-event-projector'

const DEFAULT_MAX_BINDINGS = 200
const THREAD_PAGE_SIZE = 100
const SUBAGENT_SOURCE_KINDS = [
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
] as const

const SessionMetaSchema = z.object({
  type: z.literal('session_meta'),
  timestamp: z.string(),
  payload: z.object({ id: z.string().min(1) }).passthrough(),
}).passthrough()

const TurnContextSchema = z.object({
  type: z.literal('turn_context'),
  timestamp: z.string(),
  payload: z.object({
    turn_id: z.string().min(1),
    model: z.string().min(1),
  }).passthrough(),
}).passthrough()

const NativeTokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  reasoning_output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
})

const TokenCountSchema = z.object({
  type: z.literal('event_msg'),
  timestamp: z.string(),
  payload: z.object({
    type: z.literal('token_count'),
    info: z.object({
      last_token_usage: NativeTokenUsageSchema.nullable(),
      total_token_usage: NativeTokenUsageSchema.nullable(),
    }).nullable(),
  }).passthrough(),
}).passthrough()

const ModelRerouteSchema = z.object({
  type: z.literal('event_msg'),
  timestamp: z.string(),
  payload: z.object({
    type: z.literal('model_reroute'),
    from_model: z.string().min(1),
    to_model: z.string().min(1),
  }).passthrough(),
}).passthrough()

const RolloutEnvelopeSchema = z.object({
  type: z.string(),
  payload: z.object({ type: z.string().optional() }).passthrough().optional(),
}).passthrough()

export interface CodexUsageReconciliationIncident {
  reason: string
  threadId?: string
  lineNumber?: number
}

export interface CodexUsageReconciliationSummary {
  bindings: number
  threads: number
  inserted: number
  duplicates: number
  incidents: number
  completed?: boolean
}

export interface ReconcileCodexSessionUsageInput {
  client: CodexAppServerClientLike
  sessionId: string
  providerSessionId: string
  providerTargetId: string | null
  bindingId?: string
  replaceLegacyUsage?: boolean
  runtimeHome?: string
  recordIncident?: (incident: CodexUsageReconciliationIncident) => void
}

export async function reconcileCodexSessionUsage(
  input: ReconcileCodexSessionUsageInput,
): Promise<CodexUsageReconciliationSummary> {
  const summary = emptySummary()
  summary.bindings = 1
  const recordIncident = input.recordIncident ?? (incident => recordReconciliationIncident(input.sessionId, incident))

  let threads: Thread[]
  try {
    threads = await listCodexSessionTree(input.client, input.providerSessionId)
  }
  catch (error) {
    summary.incidents += 1
    recordIncident({ reason: `Codex usage reconciliation could not read native thread metadata: ${errorMessage(error)}` })
    return summary
  }

  summary.threads = threads.length
  const events: RuntimeUsageEventContext[] = []
  for (const thread of threads) {
    if (!thread.path) {
      summary.incidents += 1
      recordIncident({ reason: 'Codex native thread metadata is missing its rollout path.', threadId: thread.id })
      continue
    }
    const result = await reconcileCodexRollout({
      path: thread.path,
      runtimeHome: input.runtimeHome ?? resolveCodexAppServerHome(),
      expectedThreadId: thread.id,
      sessionId: input.sessionId,
      providerSessionId: input.providerSessionId,
      providerTargetId: input.providerTargetId,
      recordIncident,
    })
    events.push(...result.events)
    summary.incidents += result.incidents
  }
  if (summary.incidents > 0) {
    markBindingReconciliation(input.bindingId, 'blocked')
    return { ...summary, completed: false }
  }
  if (events.length === 0 && hasLegacyCodexUsage(input.sessionId)) {
    summary.incidents += 1
    recordIncident({ reason: 'Codex usage reconciliation found no authoritative events to replace legacy usage.' })
    markBindingReconciliation(input.bindingId, 'blocked')
    return { ...summary, completed: false }
  }

  const persisted = input.replaceLegacyUsage
    ? replaceLegacyRuntimeUsage({ sessionId: input.sessionId, runtimeKind: 'codex', events })
    : persistUsageEvents(events)
  summary.inserted += persisted.inserted
  summary.duplicates += persisted.duplicates
  markBindingReconciliation(input.bindingId, 'completed')
  return { ...summary, completed: true }
}

export async function reconcileCradleCodexUsage(input: {
  maxBindings?: number
  createClient?: () => CodexAppServerClientLike
  runtimeHome?: string
} = {}): Promise<CodexUsageReconciliationSummary> {
  const bindings = db()
    .select()
    .from(backendSessionBindings)
    .where(and(
      eq(backendSessionBindings.runtimeKind, 'codex'),
      isNotNull(backendSessionBindings.backendSessionId),
      eq(backendSessionBindings.usageReconciliationStatus, 'pending'),
    ))
    .orderBy(desc(backendSessionBindings.updatedAt))
    .limit(input.maxBindings ?? DEFAULT_MAX_BINDINGS)
    .all()
  const summary = emptySummary()
  if (bindings.length === 0) {
    return summary
  }

  const client = input.createClient?.() ?? new CodexAppServerClient()
  try {
    await client.initialize()
    for (const binding of bindings) {
      if (!binding.backendSessionId) {
        continue
      }
      const result = await reconcileCodexSessionUsage({
        client,
        sessionId: binding.chatSessionId,
        providerSessionId: binding.backendSessionId,
        providerTargetId: binding.providerTargetId,
        bindingId: binding.id,
        replaceLegacyUsage: true,
        runtimeHome: input.runtimeHome,
      })
      addSummary(summary, result)
    }
  }
  catch (error) {
    for (const binding of bindings) {
      recordReconciliationIncident(binding.chatSessionId, {
        reason: `Codex usage startup reconciliation failed: ${errorMessage(error)}`,
      })
      summary.incidents += 1
    }
  }
  finally {
    await client.close()
  }
  return summary
}

async function listCodexSessionTree(
  client: CodexAppServerClientLike,
  rootThreadId: string,
): Promise<Thread[]> {
  const root = (await client.request('thread/read', {
    threadId: rootThreadId,
    includeTurns: false,
  })) as ThreadReadResponse
  if (root.thread.id !== rootThreadId) {
    throw new Error(`Codex returned thread ${root.thread.id} for root ${rootThreadId}.`)
  }

  const threads = new Map<string, Thread>([[root.thread.id, root.thread]])
  for (const archived of [false, true]) {
    let cursor: string | null = null
    do {
      const params: ThreadListParams = {
        ancestorThreadId: rootThreadId,
        archived,
        cursor,
        limit: THREAD_PAGE_SIZE,
        sortKey: 'created_at',
        sortDirection: 'asc',
        sourceKinds: [...SUBAGENT_SOURCE_KINDS],
      }
      const response = await client.request('thread/list', params) as ThreadListResponse
      for (const thread of response.data) {
        threads.set(thread.id, thread)
      }
      cursor = response.nextCursor
    } while (cursor)
  }
  return [...threads.values()]
}

async function reconcileCodexRollout(input: {
  path: string
  runtimeHome: string
  expectedThreadId: string
  sessionId: string
  providerSessionId: string
  providerTargetId: string | null
  recordIncident: (incident: CodexUsageReconciliationIncident) => void
}): Promise<{ events: RuntimeUsageEventContext[], incidents: number }> {
  const summary = emptySummary()
  const events: RuntimeUsageEventContext[] = []
  let rolloutPath: string
  try {
    rolloutPath = readContainedRolloutPath(input.runtimeHome, input.path)
  }
  catch (error) {
    summary.incidents += 1
    input.recordIncident({ reason: errorMessage(error), threadId: input.expectedThreadId })
    return { events, incidents: summary.incidents }
  }

  let observedThreadId: string | null = null
  let currentTurn: { id: string, modelId: string } | null = null
  let lineNumber = 0
  const lines = createInterface({ input: createReadStream(rolloutPath), crlfDelay: Infinity })
  for await (const line of lines) {
    lineNumber += 1
    if (!line.trim()) {
      continue
    }
    let rawLine: unknown
    try {
      rawLine = JSON.parse(line)
    }
    catch {
      summary.incidents += 1
      input.recordIncident({
        reason: 'Codex rollout contains malformed JSON.',
        threadId: input.expectedThreadId,
        lineNumber,
      })
      continue
    }
    const envelope = RolloutEnvelopeSchema.safeParse(rawLine)
    if (!envelope.success) {
      continue
    }
    if (envelope.data.type === 'session_meta') {
      const sessionMeta = SessionMetaSchema.safeParse(rawLine)
      if (!sessionMeta.success || observedThreadId) {
        summary.incidents += 1
        input.recordIncident({
          reason: 'Codex rollout contains ambiguous session metadata.',
          threadId: input.expectedThreadId,
          lineNumber,
        })
        continue
      }
      observedThreadId = sessionMeta.data.payload.id
      if (observedThreadId !== input.expectedThreadId) {
        summary.incidents += 1
        input.recordIncident({
          reason: 'Codex rollout thread identity does not match native metadata.',
          threadId: input.expectedThreadId,
          lineNumber,
        })
      }
      continue
    }
    if (envelope.data.type === 'turn_context') {
      const turnContext = TurnContextSchema.safeParse(rawLine)
      if (!turnContext.success) {
        currentTurn = null
        summary.incidents += 1
        input.recordIncident({
          reason: 'Codex rollout turn context is missing turn or model identity.',
          threadId: input.expectedThreadId,
          lineNumber,
        })
        continue
      }
      currentTurn = {
        id: turnContext.data.payload.turn_id,
        modelId: turnContext.data.payload.model,
      }
      continue
    }
    if (envelope.data.type === 'event_msg' && envelope.data.payload?.type === 'model_reroute') {
      const reroute = ModelRerouteSchema.safeParse(rawLine)
      if (!reroute.success || !currentTurn || currentTurn.modelId !== reroute.data.payload.from_model) {
        currentTurn = null
        summary.incidents += 1
        input.recordIncident({
          reason: 'Codex rollout model reroute does not match the active turn model.',
          threadId: input.expectedThreadId,
          lineNumber,
        })
        continue
      }
      currentTurn.modelId = reroute.data.payload.to_model
      continue
    }
    if (envelope.data.type !== 'event_msg' || envelope.data.payload?.type !== 'token_count') {
      continue
    }
    const tokenCount = TokenCountSchema.safeParse(rawLine)
    if (!tokenCount.success) {
      summary.incidents += 1
      input.recordIncident({
        reason: 'Codex rollout token checkpoint is malformed.',
        threadId: input.expectedThreadId,
        lineNumber,
      })
      continue
    }
    const info = tokenCount.data.payload.info
    if (!info?.last_token_usage) {
      continue
    }
    if (!observedThreadId || observedThreadId !== input.expectedThreadId || !currentTurn || !info.total_token_usage) {
      summary.incidents += 1
      input.recordIncident({
        reason: 'Codex rollout token checkpoint lacks exact thread, turn, model, or cumulative identity.',
        threadId: input.expectedThreadId,
        lineNumber,
      })
      continue
    }
    const occurredAt = readOccurredAt(tokenCount.data.timestamp)
    if (occurredAt === null) {
      summary.incidents += 1
      input.recordIncident({
        reason: 'Codex rollout token checkpoint has an invalid timestamp.',
        threadId: input.expectedThreadId,
        lineNumber,
      })
      continue
    }
    try {
      const event = createCodexRuntimeUsageEvent({
        threadId: observedThreadId,
        turnId: currentTurn.id,
        modelId: currentTurn.modelId,
        occurredAt,
        last: toProtocolUsage(info.last_token_usage),
        total: toProtocolUsage(info.total_token_usage),
      })
      events.push({
        event,
        sessionId: input.sessionId,
        runId: null,
        messageId: null,
        providerTargetId: input.providerTargetId,
        providerSessionId: input.providerSessionId,
      })
    }
    catch (error) {
      summary.incidents += 1
      input.recordIncident({
        reason: `Codex rollout usage event was rejected: ${errorMessage(error)}`,
        threadId: input.expectedThreadId,
        lineNumber,
      })
    }
  }
  return { events, incidents: summary.incidents }
}

function persistUsageEvents(events: RuntimeUsageEventContext[]): { inserted: number, duplicates: number } {
  let inserted = 0
  let duplicates = 0
  for (const event of events) {
    if (recordRuntimeUsageEvent(event) === 'inserted') {
      inserted += 1
    }
    else {
      duplicates += 1
    }
  }
  return { inserted, duplicates }
}

function markBindingReconciliation(bindingId: string | undefined, status: 'completed' | 'blocked'): void {
  if (!bindingId) {
    return
  }
  db().update(backendSessionBindings).set({
      usageReconciliationStatus: status,
      usageReconciliationAttemptedAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    }).where(eq(backendSessionBindings.id, bindingId)).run()
}

function hasLegacyCodexUsage(sessionId: string): boolean {
  return Boolean(
    db().select({ id: usageLogs.id })
      .from(usageLogs)
      .where(and(eq(usageLogs.sessionId, sessionId), isNull(usageLogs.providerThreadId)))
      .limit(1)
      .get(),
  )
}

function readContainedRolloutPath(runtimeHome: string, rolloutPath: string): string {
  const canonicalHome = realpathSync(runtimeHome)
  const canonicalPath = realpathSync(rolloutPath)
  const relativePath = relative(canonicalHome, canonicalPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Codex rollout path is outside the Cradle-owned runtime home.')
  }
  if (!statSync(canonicalPath).isFile()) {
    throw new Error('Codex rollout path does not identify a file.')
  }
  return canonicalPath
}

function toProtocolUsage(usage: z.infer<typeof NativeTokenUsageSchema>): TokenUsageBreakdown {
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    totalTokens: usage.total_tokens,
  }
}

function readOccurredAt(timestamp: string): number | null {
  const occurredAt = Date.parse(timestamp)
  return Number.isFinite(occurredAt) ? Math.floor(occurredAt / 1000) : null
}

function recordReconciliationIncident(
  sessionId: string,
  incident: CodexUsageReconciliationIncident,
): void {
  Observability.record({
    source: 'provider',
    code: OBSERVABILITY_CODES.chatUsageIngestionFailed,
    severity: 'error',
    category: 'chat',
    message: incident.reason,
    chatSessionId: sessionId,
    dedupeKey: createDedupeKey({
      code: OBSERVABILITY_CODES.chatUsageIngestionFailed,
      chatSessionId: sessionId,
    }),
    attrs: {
      runtimeKind: 'codex',
      phase: 'reconciliation',
      threadId: incident.threadId,
      lineNumber: incident.lineNumber,
    },
  })
}

function emptySummary(): CodexUsageReconciliationSummary {
  return { bindings: 0, threads: 0, inserted: 0, duplicates: 0, incidents: 0 }
}

function addSummary(
  target: CodexUsageReconciliationSummary,
  source: CodexUsageReconciliationSummary,
): void {
  target.bindings += source.bindings
  target.threads += source.threads
  target.inserted += source.inserted
  target.duplicates += source.duplicates
  target.incidents += source.incidents
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
