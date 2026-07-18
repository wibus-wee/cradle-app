import { randomUUID } from 'node:crypto'

import { awaitBypassRules, sessionAwaits, sessions, workspaces } from '@cradle/db'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import {
  fetchBranchHead,
  fetchBranchProtection,
  fetchCheckRuns,
  fetchCombinedStatus,
  fetchRepo,
  GitHubTargetValidationError,
  isGitHubMissingTarget,
} from '../../lib/github-api'
import { enqueueSessionQueueItem } from '../chat-runtime/runtime'
import {
  CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
  normalizeCradleIssueAgentAwaitFilter,
} from './sources/cradle-issue-agent'
import {
  CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
  normalizeCradleIssueStatusAwaitFilter,
} from './sources/cradle-issue-status'
import { GitHubCIFilterJsonSchema, validateGitHubCITarget } from './sources/github-ci'
import { GitHubReviewFilterJsonSchema, validateGitHubReviewTarget } from './sources/github-review'
import {
  JAVASCRIPT_AWAIT_SOURCE,
  JavaScriptAwaitFilterJsonSchema,
  validateJavaScriptAwaitFilter,
} from './sources/javascript'
import type {
  RegisterAwaitInput,
  RetryAwaitDeliveryInput,
  SessionAwait,
  SessionAwaitSummary,
  TriggerAwaitInput,
} from './types'

const SessionAwaitFilterJsonSchema = z.string().transform(raw => JSON.parse(raw))

const SupportedAwaitSourceSchema = z.enum([
  'github-ci',
  'github-review',
  'manual',
  'timer',
  CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
  CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
  JAVASCRIPT_AWAIT_SOURCE,
])
const NonBlankResumeTextSchema = z
  .string()
  .refine(value => value.trim().length > 0, 'resumeText must include non-whitespace content')

const RegisterAwaitInputSchema = z.object({
  chatSessionId: z.string(),
  workspaceId: z.string(),
  source: z.string(),
  filterJson: z.string(),
  reason: z.string().nullable().default(null),
  expiresAt: z.number().nullable().default(null),
  fireAt: z.number().nullable().default(null),
})

const TriggerAwaitInputSchema = z.object({
  awaitId: z.string(),
  resumeText: NonBlankResumeTextSchema,
  resumePayloadJson: z.string().nullable().default(null),
})

const RetryAwaitDeliveryInputSchema = z.object({
  awaitId: z.string(),
  resumeText: NonBlankResumeTextSchema.optional(),
  resumePayloadJson: z.string().nullable().optional(),
})

const LastCheckedInputSchema = z.object({
  errorText: z.string().nullable().default(null),
})

async function enqueueResume(row: SessionAwait, resumeText: string): Promise<void> {
  await enqueueSessionQueueItem({
    sessionId: row.chatSessionId,
    text: resumeText,
  })
}

function readDeliveryErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function markDeliveryFailed(
  awaitId: string,
  errorText: string,
  checkedAt: number,
): SessionAwait | null {
  db()
    .update(sessionAwaits)
    .set({
      status: 'failed',
      failureKind: 'delivery',
      triggeredAt: null,
      lastErrorText: errorText,
      lastCheckedAt: checkedAt,
    })
    .where(eq(sessionAwaits.id, awaitId))
    .run()

  return db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get() ?? null
}

// ── write operations ──

async function validateGitHubAwaitSource(source: string, filterJson: string): Promise<void> {
  try {
    if (source === 'github-ci') {
      await validateGitHubCITarget(filterJson)
    }
 else if (source === 'github-review') {
      await validateGitHubReviewTarget(filterJson)
    }
  }
 catch (err) {
    if (err instanceof GitHubTargetValidationError) {
      throw new AppError({
        code:
          err.category === 'invalid'
            ? 'github_await_target_invalid'
            : 'github_await_validation_unavailable',
        status: err.category === 'invalid' ? 400 : 503,
        message: err.message,
      })
    }
    throw new AppError({
      code: 'github_await_validation_unavailable',
      status: 503,
      message: 'Unable to validate GitHub await target right now.',
    })
  }
}

async function validateAwaitSource(source: string, filterJson: string): Promise<void> {
  await validateGitHubAwaitSource(source, filterJson)
  if (source === JAVASCRIPT_AWAIT_SOURCE) {
    await validateJavaScriptAwaitFilter(filterJson)
  }
}

function normalizeAwaitFilter(input: {
  source: string
  workspaceId: string
  filterJson: string
}): string {
  if (input.source === CRADLE_ISSUE_AGENT_AWAIT_SOURCE) {
    return normalizeCradleIssueAgentAwaitFilter(input)
  }
  if (input.source === CRADLE_ISSUE_STATUS_AWAIT_SOURCE) {
    return normalizeCradleIssueStatusAwaitFilter(input)
  }
  return input.filterJson
}

export async function register(rawInput: RegisterAwaitInput): Promise<SessionAwait> {
  const input = RegisterAwaitInputSchema.parse(rawInput)
  const source = SupportedAwaitSourceSchema.safeParse(input.source)
  if (!source.success) {
    throw new AppError({
      code: 'session_await_source_unsupported',
      status: 400,
      message: `Unsupported session await source: ${input.source}`,
      details: { supportedSources: SupportedAwaitSourceSchema.options },
    })
  }

  if (input.source === 'timer' && input.fireAt === null) {
    throw new AppError({
      code: 'session_await_timer_fire_at_required',
      status: 400,
      message: 'Timer session awaits require fireAt.',
    })
  }

  if (input.source !== 'timer' && input.fireAt !== null) {
    throw new AppError({
      code: 'session_await_fire_at_unsupported',
      status: 400,
      message: 'fireAt is only supported for timer session awaits.',
    })
  }

  if (input.source === 'github-ci') {
    GitHubCIFilterJsonSchema.parse(input.filterJson)
  }
 else if (input.source === 'github-review') {
    GitHubReviewFilterJsonSchema.parse(input.filterJson)
  }
 else if (input.source === JAVASCRIPT_AWAIT_SOURCE) {
    const filter = JavaScriptAwaitFilterJsonSchema.safeParse(input.filterJson)
    if (!filter.success) {
      throw new AppError({
        code: 'session_await_program_invalid',
        status: 400,
        message: `JavaScript await filter is invalid: ${filter.error.message}`,
      })
    }
  }
 else {
    SessionAwaitFilterJsonSchema.parse(input.filterJson)
  }

  // Validate referenced session exists
  const sessionExists = db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, input.chatSessionId))
    .get()
  if (!sessionExists) {
    throw new AppError({
      code: 'session_not_found',
      status: 404,
      message: 'Chat session not found',
    })
  }

  // Validate referenced workspace exists
  const workspaceExists = db()
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .get()
  if (!workspaceExists) {
    throw new AppError({ code: 'workspace_not_found', status: 404, message: 'Workspace not found' })
  }

  await validateAwaitSource(input.source, input.filterJson)
  const filterJson = normalizeAwaitFilter({
    source: input.source,
    workspaceId: input.workspaceId,
    filterJson: input.filterJson,
  })

  const id = randomUUID()
  return db()
    .insert(sessionAwaits)
    .values({
      id,
      chatSessionId: input.chatSessionId,
      workspaceId: input.workspaceId,
      source: input.source,
      filterJson,
      reason: input.reason,
      expiresAt: input.expiresAt,
      fireAt: input.fireAt,
    })
    .returning()
    .get()
}

export function cancel(awaitId: string): SessionAwait | null {
  return (
    db()
      .update(sessionAwaits)
      .set({ status: 'cancelled' })
      .where(and(eq(sessionAwaits.id, awaitId), eq(sessionAwaits.status, 'pending')))
      .returning()
      .get() ?? null
  )
}

export function expire(awaitId: string): SessionAwait | null {
  return (
    db()
      .update(sessionAwaits)
      .set({ status: 'expired' })
      .where(and(eq(sessionAwaits.id, awaitId), eq(sessionAwaits.status, 'pending')))
      .returning()
      .get() ?? null
  )
}

export async function trigger(rawInput: TriggerAwaitInput): Promise<SessionAwait | null> {
  const input = TriggerAwaitInputSchema.parse(rawInput)
  const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, input.awaitId)).get()

  if (!row) {
    return null
  }
  if (row.status === 'triggered') {
    return row
  } // idempotent

  if (row.status !== 'pending') {
    return null
  }

  const now = Math.floor(Date.now() / 1000)

  // Mark as triggered before dispatching resume to guarantee idempotency
  const updated = db()
    .update(sessionAwaits)
    .set({
      status: 'triggered',
      triggeredAt: now,
      resumeText: input.resumeText,
      resumePayloadJson: input.resumePayloadJson,
      failureKind: null,
      lastErrorText: null,
    })
    .where(and(eq(sessionAwaits.id, input.awaitId), eq(sessionAwaits.status, 'pending')))
    .returning()
    .get()

  if (!updated) {
    return row
  } // another trigger won the race

  // Resume through Chat Runtime's durable continuation queue. This preserves the
  // await result when the target session is currently running.
  try {
    await enqueueResume(row, input.resumeText)
  }
 catch (err) {
    return markDeliveryFailed(input.awaitId, readDeliveryErrorText(err), now)
  }

  return updated
}

export async function retryDelivery(
  rawInput: RetryAwaitDeliveryInput,
): Promise<SessionAwait | null> {
  const input = RetryAwaitDeliveryInputSchema.parse(rawInput)
  const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, input.awaitId)).get()

  if (!row) {
    return null
  }

  if (row.status === 'triggered') {
    return row
  }

  if (row.status !== 'failed' || row.failureKind !== 'delivery') {
    return null
  }

  const resumeText = input.resumeText ?? row.resumeText
  if (!resumeText || resumeText.trim().length === 0) {
    throw new AppError({
      code: 'session_await_resume_text_required',
      status: 400,
      message: 'A resumeText value is required to retry this session await delivery.',
    })
  }

  const resumePayloadJson
    = input.resumePayloadJson === undefined ? row.resumePayloadJson : input.resumePayloadJson
  const now = Math.floor(Date.now() / 1000)

  const updated = db()
    .update(sessionAwaits)
    .set({
      status: 'triggered',
      triggeredAt: now,
      resumeText,
      resumePayloadJson,
      failureKind: null,
      lastErrorText: null,
      lastCheckedAt: now,
    })
    .where(
      and(
        eq(sessionAwaits.id, input.awaitId),
        eq(sessionAwaits.status, 'failed'),
        eq(sessionAwaits.failureKind, 'delivery'),
      ),
    )
    .returning()
    .get()

  if (!updated) {
    return (
      db().select().from(sessionAwaits).where(eq(sessionAwaits.id, input.awaitId)).get() ?? null
    )
  }

  try {
    await enqueueResume(updated, resumeText)
  }
 catch (err) {
    return markDeliveryFailed(input.awaitId, readDeliveryErrorText(err), now)
  }

  return updated
}

export function markFailed(awaitId: string, errorText: string, incrementErrorCount = false): SessionAwait | null {
  const now = Math.floor(Date.now() / 1000)
  return db()
    .update(sessionAwaits)
    .set({
      status: 'failed',
      failureKind: 'source',
      lastErrorText: errorText,
      lastCheckedAt: now,
      ...(incrementErrorCount
        ? { consecutiveErrorCount: sql`${sessionAwaits.consecutiveErrorCount} + 1` }
        : {}),
    })
    .where(and(eq(sessionAwaits.id, awaitId), eq(sessionAwaits.status, 'pending')))
    .returning()
    .get() ?? null
}

// Wakes the chat session when a source adapter opts into resumeOnFailure and the
// await reaches a terminal source failure. Best-effort: a delivery failure is
// recorded on the row but never retried (unlike success delivery).
export async function resumeFailedAwait(row: SessionAwait, errorText: string): Promise<void> {
  const text = `Session await (${row.source}) failed: ${errorText}\n\nDecide how to proceed: fix the condition and register a new await, or continue without it.`
  try {
    await enqueueResume(row, text)
  }
  catch (err) {
    db()
      .update(sessionAwaits)
      .set({
        lastErrorText: `${row.lastErrorText ?? errorText} (failure resume delivery failed: ${readDeliveryErrorText(err)})`,
      })
      .where(and(
        eq(sessionAwaits.id, row.id),
        eq(sessionAwaits.status, 'failed'),
        eq(sessionAwaits.failureKind, 'source'),
      ))
      .run()
  }
}

export function updateLastChecked(awaitId: string, errorText?: string): void {
  const input = LastCheckedInputSchema.parse({ errorText })
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessionAwaits)
    .set({
      lastCheckedAt: now,
      lastErrorText: input.errorText,
    })
    .where(and(eq(sessionAwaits.id, awaitId), eq(sessionAwaits.status, 'pending')))
    .run()
}

// Used by sources that opt into tracksConsecutiveErrors (javascript). Keeps the
// shared updateLastChecked path free of counter side effects for other sources.
export function recordTrackedEvaluationCheck(awaitId: string, errorText?: string): void {
  const input = LastCheckedInputSchema.parse({ errorText })
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessionAwaits)
    .set({
      lastCheckedAt: now,
      lastErrorText: input.errorText,
      consecutiveErrorCount: input.errorText === null
        ? 0
        : sql`${sessionAwaits.consecutiveErrorCount} + 1`,
    })
    .where(and(eq(sessionAwaits.id, awaitId), eq(sessionAwaits.status, 'pending')))
    .run()
}

export function bypassCheck(awaitId: string, checkName: string): SessionAwait | null {
  const row = db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get()
  if (!row || row.status !== 'pending') {
    return null
  }

  const existing: string[] = row.bypassedChecksJson ? JSON.parse(row.bypassedChecksJson) : []
  if (existing.includes(checkName)) {
    return row
  }
  existing.push(checkName)

  return db()
    .update(sessionAwaits)
    .set({ bypassedChecksJson: JSON.stringify(existing) })
    .where(eq(sessionAwaits.id, awaitId))
    .returning()
    .get()
}

export function getBypassedChecks(awaitId: string): string[] {
  const row = db()
    .select({ bypassedChecksJson: sessionAwaits.bypassedChecksJson })
    .from(sessionAwaits)
    .where(eq(sessionAwaits.id, awaitId))
    .get()
  if (!row?.bypassedChecksJson) {
    return []
  }
  return JSON.parse(row.bypassedChecksJson) as string[]
}

// ── read operations ──

export function get(awaitId: string): SessionAwait | null {
  return db().select().from(sessionAwaits).where(eq(sessionAwaits.id, awaitId)).get() ?? null
}

export function listBySession(sessionId: string): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.chatSessionId, sessionId))
    .orderBy(desc(sessionAwaits.createdAt), desc(sessionAwaits.triggeredAt), asc(sessionAwaits.id))
    .all()
}

export function listPendingBySource(source: string): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(and(eq(sessionAwaits.source, source), eq(sessionAwaits.status, 'pending')))
    .orderBy(asc(sessionAwaits.createdAt), asc(sessionAwaits.id))
    .all()
}

export function listAllPending(): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.status, 'pending'))
    .orderBy(asc(sessionAwaits.createdAt), asc(sessionAwaits.id))
    .all()
}

export function getSessionSummary(sessionId: string): SessionAwaitSummary {
  const pending = db()
    .select()
    .from(sessionAwaits)
    .where(and(eq(sessionAwaits.chatSessionId, sessionId), eq(sessionAwaits.status, 'pending')))
    .orderBy(asc(sessionAwaits.createdAt), asc(sessionAwaits.id))
    .all()

  if (pending.length === 0) {
    return {
      awaiting: false,
      pendingCount: 0,
      primaryAwaitId: null,
      primarySource: null,
      reason: null,
    }
  }

  const first = pending[0]
  return {
    awaiting: true,
    pendingCount: pending.length,
    primaryAwaitId: first.id,
    primarySource: first.source,
    reason: first.reason,
  }
}

// ── bypass rules ──

export type BypassRule = typeof awaitBypassRules.$inferSelect

export function listBypassRules(workspaceId: string): BypassRule[] {
  return db()
    .select()
    .from(awaitBypassRules)
    .where(eq(awaitBypassRules.workspaceId, workspaceId))
    .all()
}

export function createBypassRule(
  workspaceId: string,
  repo: string,
  checkPattern: string,
): BypassRule {
  const id = randomUUID()
  return db()
    .insert(awaitBypassRules)
    .values({ id, workspaceId, repo, checkPattern })
    .returning()
    .get()
}

export function deleteBypassRule(ruleId: string): boolean {
  const result = db().delete(awaitBypassRules).where(eq(awaitBypassRules.id, ruleId)).run()
  return result.changes > 0
}

export function toggleBypassRule(ruleId: string, enabled: boolean): BypassRule | null {
  return (
    db()
      .update(awaitBypassRules)
      .set({ enabled: enabled ? 1 : 0 })
      .where(eq(awaitBypassRules.id, ruleId))
      .returning()
      .get() ?? null
  )
}

export function getMatchingBypassPatterns(workspaceId: string, repo: string): string[] {
  const rules = db()
    .select({ checkPattern: awaitBypassRules.checkPattern })
    .from(awaitBypassRules)
    .where(
      and(
        eq(awaitBypassRules.workspaceId, workspaceId),
        eq(awaitBypassRules.repo, repo),
        eq(awaitBypassRules.enabled, 1),
      ),
    )
    .all()
  return rules.map(r => r.checkPattern)
}

export function globMatch(name: string, pattern: string): boolean {
  // Convert glob pattern to regex: * -> .*, ? -> ., escape the rest
  const regexStr = `^${pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')}$`
  return new RegExp(regexStr).test(name)
}

export function matchesAnyBypassPattern(name: string, patterns: Iterable<string>): boolean {
  for (const pattern of patterns) {
    if (globMatch(name, pattern)) {
      return true
    }
  }
  return false
}

// ── discovered repos & available checks ──

export function listDiscoveredRepos(workspaceId: string): string[] {
  const rows = db()
    .select({ filterJson: sessionAwaits.filterJson })
    .from(sessionAwaits)
    .where(and(eq(sessionAwaits.workspaceId, workspaceId)))
    .all()

  const repos = new Set<string>()
  for (const row of rows) {
    if (row.filterJson) {
      try {
        const parsed = JSON.parse(row.filterJson)
        if (typeof parsed.repo === 'string') {
          repos.add(parsed.repo)
        }
      }
 catch {
        /* ignore malformed filterJson */
      }
    }
  }
  return [...repos].sort()
}

export interface AvailableCheck {
  name: string
  required: boolean
  source: 'check-run' | 'status'
}

export interface AvailableChecksResult {
  owner: string
  repo: string
  defaultBranch: string
  checks: AvailableCheck[]
}

export async function fetchAvailableChecks(
  owner: string,
  repo: string,
): Promise<AvailableChecksResult> {
  let repoInfo: Awaited<ReturnType<typeof fetchRepo>>
  try {
    repoInfo = await fetchRepo(owner, repo)
  }
 catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new AppError({
        code: 'github_repo_not_found',
        status: 404,
        message: `Repository ${owner}/${repo} not found or inaccessible`,
      })
    }
    throw err
  }
  if (!repoInfo) {
    throw new AppError({
      code: 'github_repo_unavailable',
      status: 503,
      message: `Repository ${owner}/${repo} could not be checked right now`,
    })
  }

  const defaultBranch = repoInfo.default_branch
  let headInfo: Awaited<ReturnType<typeof fetchBranchHead>>
  try {
    headInfo = await fetchBranchHead(owner, repo, defaultBranch)
  }
 catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new AppError({
        code: 'github_repo_default_branch_not_found',
        status: 404,
        message: `Default branch ${defaultBranch} for ${owner}/${repo} not found or inaccessible`,
      })
    }
    throw err
  }
  if (!headInfo) {
    return { owner, repo, defaultBranch, checks: [] }
  }

  const [checkRunsResp, combinedStatus, branchProtection] = await Promise.all([
    fetchCheckRuns(owner, repo, headInfo.sha),
    fetchCombinedStatus(owner, repo, headInfo.sha),
    fetchBranchProtection(owner, repo, defaultBranch),
  ])

  const requiredContexts = new Set(branchProtection?.requiredContexts ?? [])
  const seen = new Map<string, AvailableCheck>()

  for (const run of checkRunsResp?.check_runs ?? []) {
    if (!seen.has(run.name)) {
      seen.set(run.name, {
        name: run.name,
        required: requiredContexts.has(run.name),
        source: 'check-run',
      })
    }
 else if (requiredContexts.has(run.name)) {
      seen.get(run.name)!.required = true
    }
  }

  for (const status of combinedStatus?.statuses ?? []) {
    if (!seen.has(status.context)) {
      seen.set(status.context, {
        name: status.context,
        required: requiredContexts.has(status.context),
        source: 'status',
      })
    }
 else if (requiredContexts.has(status.context)) {
      seen.get(status.context)!.required = true
    }
  }

  const checks = [...seen.values()].sort((a, b) => {
    if (a.required !== b.required) {
      return a.required ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  return { owner, repo, defaultBranch, checks }
}
