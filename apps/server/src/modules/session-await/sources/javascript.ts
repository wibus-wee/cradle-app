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
export const MAX_CONSECUTIVE_EVALUATION_ERRORS = 5

const JAVASCRIPT_EVAL_TIMEOUT_MS = 45_000
const VALIDATION_TIMEOUT_MS = 10_000

const JavaScriptAwaitStoredFilterSchema = z.object({
  program: z.string().min(1).max(MAX_PROGRAM_BYTES),
})

export const JavaScriptAwaitFilterJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(JavaScriptAwaitStoredFilterSchema)

type JavaScriptAwaitStoredFilter = z.infer<typeof JavaScriptAwaitStoredFilterSchema>

// Await cell contract: the cell returns `false` while the condition is still
// pending, or `{ resumeText, payload? }` once it completes. Anything else is a
// terminal failure of the await.
export type AwaitCellResult = false | { resumeText: string, payload?: unknown }

export async function validateJavaScriptAwaitFilter(filterJson: string): Promise<void> {
  const filter = JavaScriptAwaitFilterJsonSchema.safeParse(filterJson)
  if (!filter.success) {
    throw new AppError({
      code: 'session_await_program_invalid',
      status: 400,
      message: `JavaScript await filter is invalid: ${filter.error.message}`,
    })
  }

  // Check mode imports the module and verifies the default export shape without
  // ever calling the cell.
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
      ? 'Program ran unexpectedly during validation'
      : outcome.error
  throw new AppError({
    code: 'session_await_program_invalid',
    status: 400,
    message: `JavaScript await program is invalid: ${detail}`,
  })
}

type ReadCellResult
  = | { ok: true, matched: false }
    | { ok: true, matched: true, resumeText: string, resumePayloadJson?: string }
    | { ok: false, reason: string }

function readAwaitCellResult(result: unknown): ReadCellResult {
  if (result === false) {
    return { ok: true, matched: false }
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return {
      ok: false,
      reason: `expected false or an object with a resumeText string, got ${result === null ? 'null' : typeof result}`,
    }
  }

  const { resumeText, payload } = result as { resumeText?: unknown, payload?: unknown }
  if (typeof resumeText !== 'string' || resumeText.trim().length === 0) {
    return { ok: false, reason: 'resumeText must be a non-blank string' }
  }

  let resumePayloadJson: string | undefined
  if (payload !== undefined) {
    try {
      resumePayloadJson = JSON.stringify(payload)
    }
    catch {
      return { ok: false, reason: 'payload is not JSON-serializable' }
    }
    if (typeof resumePayloadJson !== 'string') {
      return { ok: false, reason: 'payload is not JSON-serializable' }
    }
    if (Buffer.byteLength(resumePayloadJson, 'utf8') > MAX_RESUME_PAYLOAD_BYTES) {
      return { ok: false, reason: `payload exceeds the ${MAX_RESUME_PAYLOAD_BYTES} byte limit` }
    }
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
      return { awaitId: row.id, matched: false }
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

  const errorText = outcome.kind === 'timeout'
    ? `Evaluation timed out after ${JAVASCRIPT_EVAL_TIMEOUT_MS} ms`
    : outcome.kind === 'check-passed'
      ? 'Cell evaluation did not run'
      : outcome.error
  return evaluationFailureResult(row, errorText)
}

export const javascriptAwaitSource: SessionAwaitSource = {
  source: JAVASCRIPT_AWAIT_SOURCE,
  resumeOnFailure: true,
  async checkPending(awaits) {
    // Sequential on purpose (v1): the poller caps the batch at 100 awaits per
    // cycle and a backlog of slow cells serializes instead of fanning out.
    const results: CheckResult[] = []
    for (const row of awaits) {
      results.push(await checkJavaScriptAwait(row))
    }
    return results
  },
}
