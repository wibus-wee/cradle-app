import { Elysia } from 'elysia'

import { AppError } from '../../errors/app-error'
import {
  EVAL_DEFAULT_TIMEOUT_MS,
  EVAL_MAX_TIMEOUT_MS,
  evaluateCell,
  MAX_PROGRAM_BYTES,
} from './evaluator'
import { JavaScriptEvalModel } from './model'

export const javascriptEval = new Elysia({
  prefix: '/javascript',
  detail: { tags: ['javascript'] },
})
  .post('/evaluate', async ({ body }) => {
    if (Buffer.byteLength(body.program, 'utf8') > MAX_PROGRAM_BYTES) {
      throw new AppError({
        code: 'javascript_program_too_large',
        status: 400,
        message: `JavaScript program exceeds the ${MAX_PROGRAM_BYTES} byte limit.`,
      })
    }

    const timeoutMs = Math.min(
      Math.max(body.timeoutMs ?? EVAL_DEFAULT_TIMEOUT_MS, 1000),
      EVAL_MAX_TIMEOUT_MS,
    )
    const outcome = await evaluateCell({ program: body.program, timeoutMs, cwd: body.cwd })

    if (outcome.kind === 'completed') {
      return { ok: true, result: outcome.result }
    }
    if (outcome.kind === 'timeout') {
      return { ok: false, error: `Evaluation timed out after ${timeoutMs} ms`, kind: outcome.kind }
    }
    if (outcome.kind === 'check-passed') {
      return { ok: true, kind: outcome.kind }
    }
    return { ok: false, error: outcome.error, kind: outcome.kind }
  }, {
    detail: { summary: 'Evaluate a JavaScript cell in an isolated managed process' },
    body: JavaScriptEvalModel.evaluateBody,
    response: { 200: JavaScriptEvalModel.evaluateResponse },
  })
