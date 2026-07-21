import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { createInterface } from 'node:readline'

import { backendSessionBindings, providerTargets, usageLogs } from '@cradle/db'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../../infra'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import * as Observability from '../../observability/service'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import type { RuntimeUsageEventContext } from '../../usage/ingest'
import { recordRuntimeUsageEvent, replaceLegacyRuntimeUsage } from '../../usage/ingest'
import { resolveClaudeAgentSdkConfigDir } from './runtime-context'
import { projectClaudeAssistantUsageEvent } from './usage-event-projector'

const DEFAULT_MAX_BINDINGS = 200

const TranscriptRecordSchema = z.object({
  type: z.string(),
  sessionId: z.string().min(1).optional(),
  parent_tool_use_id: z.string().min(1).optional(),
  timestamp: z.string().min(1).optional(),
  message: z.object({
    id: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    usage: z.object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cache_read_input_tokens: z.number().int().nonnegative().optional(),
      cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    }).optional(),
  }).passthrough().optional(),
}).passthrough()

export interface ClaudeUsageReconciliationIncident {
  reason: string
  path?: string
  lineNumber?: number
}

export interface ClaudeUsageReconciliationSummary {
  bindings: number
  transcripts: number
  inserted: number
  duplicates: number
  incidents: number
  completed?: boolean
}

export async function reconcileClaudeSessionUsage(input: {
  sessionId: string
  providerSessionId: string
  providerTargetId: string | null
  bindingId?: string
  runtimeHome?: string
  replaceLegacyUsage?: boolean
  recordIncident?: (incident: ClaudeUsageReconciliationIncident) => void
}): Promise<ClaudeUsageReconciliationSummary> {
  const summary = emptySummary()
  summary.bindings = 1
  const recordIncident = input.recordIncident ?? (incident => recordReconciliationIncident(input.sessionId, incident))
  const runtimeHome = input.runtimeHome ?? resolveClaudeAgentSdkConfigDir()
  let transcriptPaths: string[]
  try {
    transcriptPaths = findClaudeTranscriptPaths(runtimeHome, input.providerSessionId)
  }
  catch (error) {
    summary.incidents += 1
    recordIncident({
      reason: `Claude usage reconciliation could not locate a Cradle-owned transcript: ${errorMessage(error)}`,
    })
    markBindingReconciliation(input.bindingId, 'blocked')
    return { ...summary, completed: false }
  }
  if (transcriptPaths.length === 0) {
    summary.incidents += 1
    recordIncident({ reason: 'Claude usage reconciliation could not locate a Cradle-owned transcript.' })
    markBindingReconciliation(input.bindingId, 'blocked')
    return { ...summary, completed: false }
  }

  const events: RuntimeUsageEventContext[] = []
  for (const path of transcriptPaths) {
    summary.transcripts += 1
    try {
      const result = await readClaudeTranscript({
        path,
        runtimeHome,
        providerSessionId: input.providerSessionId,
        sessionId: input.sessionId,
        providerTargetId: input.providerTargetId,
        recordIncident,
      })
      events.push(...result.events)
      summary.incidents += result.incidents
    }
    catch (error) {
      summary.incidents += 1
      recordIncident({ reason: `Claude transcript could not be replayed: ${errorMessage(error)}`, path })
    }
  }
  if (summary.incidents > 0) {
    markBindingReconciliation(input.bindingId, 'blocked')
    return { ...summary, completed: false }
  }
  if (events.length === 0 && hasLegacyUsage(input.sessionId)) {
    summary.incidents += 1
    recordIncident({ reason: 'Claude usage reconciliation found no authoritative events to replace legacy usage.' })
    markBindingReconciliation(input.bindingId, 'blocked')
    return { ...summary, completed: false }
  }

  const persisted = input.replaceLegacyUsage
    ? replaceLegacyRuntimeUsage({ sessionId: input.sessionId, runtimeKind: 'claude-agent', events })
    : persistUsageEvents(events)
  summary.inserted += persisted.inserted
  summary.duplicates += persisted.duplicates
  markBindingReconciliation(input.bindingId, 'completed')
  return { ...summary, completed: true }
}

export async function reconcileCradleClaudeUsage(input: {
  maxBindings?: number
  runtimeHome?: string
} = {}): Promise<ClaudeUsageReconciliationSummary> {
  const bindings = db().select().from(backendSessionBindings).where(and(
      eq(backendSessionBindings.runtimeKind, 'claude-agent'),
      isNotNull(backendSessionBindings.backendSessionId),
      eq(backendSessionBindings.usageReconciliationStatus, 'pending'),
    )).orderBy(desc(backendSessionBindings.updatedAt)).limit(input.maxBindings ?? DEFAULT_MAX_BINDINGS).all()
  const summary = emptySummary()
  for (const binding of bindings) {
    if (!binding.backendSessionId || !isApiKeyClaudeBinding(binding.providerTargetId)) {
      markBindingReconciliation(binding.id, 'unavailable')
      continue
    }
    addSummary(summary, await reconcileClaudeSessionUsage({
      sessionId: binding.chatSessionId,
      providerSessionId: binding.backendSessionId,
      providerTargetId: binding.providerTargetId,
      bindingId: binding.id,
      runtimeHome: input.runtimeHome,
      replaceLegacyUsage: true,
    }))
  }
  return summary
}

function isApiKeyClaudeBinding(providerTargetId: string | null): boolean {
  if (!providerTargetId) {
    return false
  }
  const target = db().select({ configJson: providerTargets.connectionConfigJson }).from(providerTargets).where(eq(providerTargets.id, providerTargetId)).get()
  if (!target) {
    return false
  }
  try {
    return readTrustedClaudeAgentConfig(target.configJson).authMode === 'apiKey'
  }
  catch {
    return false
  }
}

async function readClaudeTranscript(input: {
  path: string
  runtimeHome: string
  providerSessionId: string
  sessionId: string
  providerTargetId: string | null
  recordIncident: (incident: ClaudeUsageReconciliationIncident) => void
}): Promise<{ events: RuntimeUsageEventContext[], incidents: number }> {
  const path = readContainedTranscriptPath(input.runtimeHome, input.path)
  const events: RuntimeUsageEventContext[] = []
  let incidents = 0
  let lineNumber = 0
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    lineNumber += 1
    let record: z.infer<typeof TranscriptRecordSchema>
    try {
      record = TranscriptRecordSchema.parse(JSON.parse(line))
    }
    catch (error) {
      incidents += 1
      input.recordIncident({ reason: `Claude transcript contains invalid JSONL: ${errorMessage(error)}`, path, lineNumber })
      continue
    }
    if (record.type !== 'assistant') {
      continue
    }
    if (record.sessionId !== input.providerSessionId) {
      incidents += 1
      input.recordIncident({ reason: 'Claude transcript assistant record has a mismatched provider session.', path, lineNumber })
      continue
    }
    const occurredAt = record.timestamp ? Date.parse(record.timestamp) : Number.NaN
    if (!Number.isFinite(occurredAt)) {
      incidents += 1
      input.recordIncident({ reason: 'Claude transcript assistant record has an invalid timestamp.', path, lineNumber })
      continue
    }
    try {
      const event = projectClaudeAssistantUsageEvent({
        message: {
          type: 'assistant',
          session_id: record.sessionId,
          ...(record.parent_tool_use_id ? { parent_tool_use_id: record.parent_tool_use_id } : {}),
          message: record.message,
        } as never,
        fallbackModelId: null,
        occurredAt: Math.floor(occurredAt / 1000),
      })
      if (event) {
        events.push({
          event,
          sessionId: input.sessionId,
          runId: null,
          messageId: null,
          providerTargetId: input.providerTargetId,
          providerSessionId: input.providerSessionId,
        })
      }
    }
    catch (error) {
      incidents += 1
      input.recordIncident({ reason: `Claude transcript usage event was rejected: ${errorMessage(error)}`, path, lineNumber })
    }
  }
  return { events, incidents }
}

function findClaudeTranscriptPaths(runtimeHome: string, providerSessionId: string): string[] {
  const root = readContainedTranscriptPath(runtimeHome, findClaudeSessionPath(runtimeHome, providerSessionId))
  const paths = [root]
  const subagents = join(root, '..', 'subagents')
  if (!existsSync(subagents)) {
    return paths
  }
  for (const entry of readdirSync(subagents, { recursive: true })) {
    if (typeof entry === 'string' && /^agent-[^/]+\.jsonl$/.test(entry)) {
      paths.push(readContainedTranscriptPath(runtimeHome, join(subagents, entry)))
    }
  }
  return paths
}

function findClaudeSessionPath(runtimeHome: string, providerSessionId: string): string {
  const projects = join(runtimeHome, 'projects')
  for (const project of readdirSync(projects)) {
    const candidate = join(projects, project, `${providerSessionId}.jsonl`)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error('Claude transcript does not exist.')
}

function readContainedTranscriptPath(runtimeHome: string, path: string): string {
  const canonicalHome = realpathSync(runtimeHome)
  const canonicalPath = realpathSync(path)
  const relativePath = relative(canonicalHome, canonicalPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath) || !statSync(canonicalPath).isFile()) {
    throw new Error('Claude transcript path is outside the Cradle-owned runtime home.')
  }
  return canonicalPath
}

function persistUsageEvents(events: RuntimeUsageEventContext[]): { inserted: number, duplicates: number } {
  let inserted = 0
  let duplicates = 0
  for (const event of events) {
    if (recordRuntimeUsageEvent(event) === 'inserted') { inserted += 1 }
    else { duplicates += 1 }
  }
  return { inserted, duplicates }
}

function hasLegacyUsage(sessionId: string): boolean {
  return Boolean(db().select({ id: usageLogs.id }).from(usageLogs)
    .where(and(eq(usageLogs.sessionId, sessionId), isNull(usageLogs.providerThreadId))).limit(1).get())
}

function markBindingReconciliation(bindingId: string | undefined, status: 'completed' | 'blocked' | 'unavailable'): void {
  if (!bindingId) { return }
  const now = Math.floor(Date.now() / 1000)
  db().update(backendSessionBindings).set({ usageReconciliationStatus: status, usageReconciliationAttemptedAt: now, updatedAt: now }).where(eq(backendSessionBindings.id, bindingId)).run()
}

function recordReconciliationIncident(sessionId: string, incident: ClaudeUsageReconciliationIncident): void {
  Observability.record({
    source: 'provider',
    code: OBSERVABILITY_CODES.chatUsageIngestionFailed,
    severity: 'error',
    category: 'chat',
    message: incident.reason,
    chatSessionId: sessionId,
    dedupeKey: createDedupeKey({ code: OBSERVABILITY_CODES.chatUsageIngestionFailed, chatSessionId: sessionId, runId: null }),
    attrs: { runtimeKind: 'claude-agent', phase: 'reconciliation', path: incident.path, lineNumber: incident.lineNumber },
  })
}

function emptySummary(): ClaudeUsageReconciliationSummary {
  return { bindings: 0, transcripts: 0, inserted: 0, duplicates: 0, incidents: 0 }
}

function addSummary(target: ClaudeUsageReconciliationSummary, source: ClaudeUsageReconciliationSummary): void {
  target.bindings += source.bindings
  target.transcripts += source.transcripts
  target.inserted += source.inserted
  target.duplicates += source.duplicates
  target.incidents += source.incidents
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
