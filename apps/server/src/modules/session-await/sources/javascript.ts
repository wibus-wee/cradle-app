import { workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import {
  evaluateCell,
  MAX_PROGRAM_BYTES,
} from '../../javascript-eval/evaluator'
import {
  isLocalWorkspaceLocator,
  readWorkspaceLocatorJson,
} from '../../workspace/workspace-locator'
import type { CheckResult, SessionAwait, SessionAwaitSource } from '../types'

export const JAVASCRIPT_AWAIT_SOURCE = 'javascript'

export const MAX_RESUME_PAYLOAD_BYTES = 32 * 1024
export const MAX_RESUME_TEXT_BYTES = 32 * 1024
export const MAX_OBSERVATION_BYTES = 8 * 1024
export const MAX_CONSECUTIVE_EVALUATION_ERRORS = 5

// Cell evaluations are short checks, not long-running wait loops. The poller
// owns multi-day waiting by re-checking on its interval; the cell must return
// quickly with `false` or `{ resumeText }`.
const JAVASCRIPT_EVAL_TIMEOUT_MS = 15_000
const VALIDATION_TIMEOUT_MS = 10_000
const JAVASCRIPT_POLL_INTERVAL_MS = 30_000

const JavaScriptAwaitStoredFilterSchema = z.object({
  program: z.string().min(1).refine(
    program => Buffer.byteLength(program, 'utf8') <= MAX_PROGRAM_BYTES,
    { message: `program exceeds the ${MAX_PROGRAM_BYTES} byte limit` },
  ),
})

export const JavaScriptAwaitFilterJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(JavaScriptAwaitStoredFilterSchema)

type JavaScriptAwaitStoredFilter = z.infer<typeof JavaScriptAwaitStoredFilterSchema>

// Await cell contract: the cell returns `false` or `{ pending: true,
// progress? }` while the condition is still pending, or `{ resumeText,
// payload? }` once it completes. Anything else is a terminal failure of the
// await. `progress` is an optional JSON-serializable observation surfaced in
// the UI so a pending await is not a black box.
export type AwaitCellResult = false | { pending: true, progress?: unknown } | { resumeText: string, payload?: unknown }

export async function validateJavaScriptAwaitFilter(filterJson: string): Promise<void> {
  const filter = JavaScriptAwaitFilterJsonSchema.safeParse(filterJson)
  if (!filter.success) {
    throw new AppError({
      code: 'session_await_program_invalid',
      status: 400,
      message: `JavaScript await filter is invalid: ${filter.error.message}`,
    })
  }

  // Check mode parses the normalized ES module in a disposable Node process. It
  // does not import the module, so top-level code cannot run during registration.
  const outcome = await evaluateCell({
    program: filter.data.program,
    mode: 'check',
    timeoutMs: VALIDATION_TIMEOUT_MS,
  })
  if (outcome.kind === 'check-passed') {
    return
  }
  const detail = outcome.kind === 'timeout'
    ? `Evaluation timed out after ${VALIDATION_TIMEOUT_MS} ms`
    : outcome.kind === 'completed'
      ? 'Program validation returned an unexpected result'
      : outcome.error
  throw new AppError({
    code: 'session_await_program_invalid',
    status: 400,
    message: `JavaScript await program is invalid: ${detail}`,
  })
}

type ReadCellResult
  = | { ok: true, matched: false, observationJson: string | null }
    | { ok: true, matched: true, resumeText: string, resumePayloadJson?: string }
    | { ok: false, reason: string }

function serializeCellJson(value: unknown, limitBytes: number, label: string): { ok: true, json: string } | { ok: false, reason: string } {
  let json: string
  try {
    json = JSON.stringify(value)
  }
  catch {
    return { ok: false, reason: `${label} is not JSON-serializable` }
  }
  if (typeof json !== 'string') {
    return { ok: false, reason: `${label} is not JSON-serializable` }
  }
  if (Buffer.byteLength(json, 'utf8') > limitBytes) {
    return { ok: false, reason: `${label} exceeds the ${limitBytes} byte limit` }
  }
  return { ok: true, json }
}

function readAwaitCellResult(result: unknown): ReadCellResult {
  if (result === false) {
    return { ok: true, matched: false, observationJson: null }
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return {
      ok: false,
      reason: `expected false, a pending object, or an object with a resumeText string, got ${result === null ? 'null' : typeof result}`,
    }
  }

  const { pending, progress, resumeText, payload } = result as {
    pending?: unknown
    progress?: unknown
    resumeText?: unknown
    payload?: unknown
  }

  if (pending === true) {
    if (resumeText !== undefined || payload !== undefined) {
      return { ok: false, reason: 'a pending result must not carry resumeText or payload' }
    }
    if (progress === undefined) {
      return { ok: true, matched: false, observationJson: null }
    }
    const serialized = serializeCellJson(progress, MAX_OBSERVATION_BYTES, 'progress')
    if (!serialized.ok) {
      return serialized
    }
    return { ok: true, matched: false, observationJson: serialized.json }
  }

  if (typeof resumeText !== 'string' || resumeText.trim().length === 0) {
    return { ok: false, reason: 'resumeText must be a non-blank string' }
  }
  if (Buffer.byteLength(resumeText, 'utf8') > MAX_RESUME_TEXT_BYTES) {
    return { ok: false, reason: `resumeText exceeds the ${MAX_RESUME_TEXT_BYTES} byte limit` }
  }

  let resumePayloadJson: string | undefined
  if (payload !== undefined) {
    const serialized = serializeCellJson(payload, MAX_RESUME_PAYLOAD_BYTES, 'payload')
    if (!serialized.ok) {
      return serialized
    }
    resumePayloadJson = serialized.json
  }

  return { ok: true, matched: true, resumeText, ...(resumePayloadJson === undefined ? {} : { resumePayloadJson }) }
}

function readStoredFilter(row: SessionAwait): JavaScriptAwaitStoredFilter | null {
  try {
    return JavaScriptAwaitStoredFilterSchema.parse(JSON.parse(row.filterJson))
  }
  catch {
    return null
  }
}

function readLocalWorkspacePath(row: SessionAwait): string | null {
  const workspace = db()
    .select({ locatorJson: workspaces.locatorJson })
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .get()
  if (!workspace) {
    return null
  }
  try {
    const locator = readWorkspaceLocatorJson(workspace.locatorJson)
    return isLocalWorkspaceLocator(locator) ? locator.path : null
  }
  catch {
    return null
  }
}

function evaluationFailureResult(row: SessionAwait, errorText: string): CheckResult {
  if (row.consecutiveErrorCount + 1 >= MAX_CONSECUTIVE_EVALUATION_ERRORS) {
    return {
      awaitId: row.id,
      matched: false,
      permanentError: `Evaluation failed ${MAX_CONSECUTIVE_EVALUATION_ERRORS} times consecutively; last error: ${errorText}`,
      incrementErrorCount: true,
    }
  }
  return { awaitId: row.id, matched: false, transientError: errorText }
}

async function checkJavaScriptAwait(row: SessionAwait): Promise<CheckResult> {
  const filter = readStoredFilter(row)
  if (!filter) {
    return {
      awaitId: row.id,
      matched: false,
      permanentError: 'Stored javascript await filter is invalid',
    }
  }

  const cwd = readLocalWorkspacePath(row)
  if (cwd === null) {
    return {
      awaitId: row.id,
      matched: false,
      permanentError: 'Workspace for javascript await no longer exists or is not local',
    }
  }

  const outcome = await evaluateCell({
    program: filter.program,
    cwd,
    timeoutMs: JAVASCRIPT_EVAL_TIMEOUT_MS,
  })

  if (outcome.kind === 'completed') {
    const cellResult = readAwaitCellResult(outcome.result)
    if (!cellResult.ok) {
      return {
        awaitId: row.id,
        matched: false,
        permanentError: `Cell returned an invalid result: ${cellResult.reason}`,
      }
    }
    if (!cellResult.matched) {
      return { awaitId: row.id, matched: false, observationJson: cellResult.observationJson }
    }
    return {
      awaitId: row.id,
      matched: true,
      resumeText: cellResult.resumeText,
      ...(cellResult.resumePayloadJson === undefined
        ? {}
        : { resumePayloadJson: cellResult.resumePayloadJson }),
    }
  }

  if (outcome.kind === 'program-error') {
    return {
      awaitId: row.id,
      matched: false,
      permanentError: `Cell program is invalid: ${outcome.error}`,
    }
  }

  const errorText = outcome.kind === 'timeout'
    ? `Evaluation timed out after ${JAVASCRIPT_EVAL_TIMEOUT_MS} ms`
    : outcome.kind === 'check-passed'
      ? 'Cell evaluation did not run'
      : outcome.error
  return evaluationFailureResult(row, errorText)
}

export const javascriptAwaitSource: SessionAwaitSource = {
  source: JAVASCRIPT_AWAIT_SOURCE,
  // Heavy managed-process evaluations run on the session-await heavy-check
  // queue so they never block inline sources (github-ci, cradle-*, …).
  execution: 'queued',
  pollIntervalMs: JAVASCRIPT_POLL_INTERVAL_MS,
  resumeOnFailure: true,
  tracksConsecutiveErrors: true,
  async checkPending(awaits) {
    // The heavy-check queue calls this one row at a time with its own concurrency.
    return Promise.all(awaits.map(checkJavaScriptAwait))
  },
}

// One-shot preview for the UI "evaluate now" action. Runs the stored cell
// once with the await workspace cwd and reports the raw outcome without
// touching await status, error counters, or the stored observation — the
// poller remains the only writer of those.
export type JavaScriptAwaitPreview
  = | { ok: true, matched: false, observationJson: string | null }
    | { ok: true, matched: true, resumeText: string, resumePayloadJson?: string }
    | { ok: false, error: string }

export async function previewJavaScriptAwait(row: SessionAwait): Promise<JavaScriptAwaitPreview> {
  const filter = readStoredFilter(row)
  if (!filter) {
    return { ok: false, error: 'Stored javascript await filter is invalid' }
  }
  const cwd = readLocalWorkspacePath(row)
  if (cwd === null) {
    return { ok: false, error: 'Workspace for javascript await no longer exists or is not local' }
  }

  const outcome = await evaluateCell({
    program: filter.program,
    cwd,
    timeoutMs: JAVASCRIPT_EVAL_TIMEOUT_MS,
  })

  if (outcome.kind === 'completed') {
    const cellResult = readAwaitCellResult(outcome.result)
    if (!cellResult.ok) {
      return { ok: false, error: `Cell returned an invalid result: ${cellResult.reason}` }
    }
    if (!cellResult.matched) {
      return { ok: true, matched: false, observationJson: cellResult.observationJson }
    }
    return {
      ok: true,
      matched: true,
      resumeText: cellResult.resumeText,
      ...(cellResult.resumePayloadJson === undefined ? {} : { resumePayloadJson: cellResult.resumePayloadJson }),
    }
  }

  const error = outcome.kind === 'timeout'
    ? `Evaluation timed out after ${JAVASCRIPT_EVAL_TIMEOUT_MS} ms`
    : outcome.kind === 'check-passed'
      ? 'Cell evaluation did not run'
      : outcome.error
  return { ok: false, error }
}
