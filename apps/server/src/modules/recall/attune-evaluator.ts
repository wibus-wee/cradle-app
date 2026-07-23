import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateCell } from '../javascript-eval/evaluator'
import type { RecallInvocationContext } from './evaluator'

const localModuleDir = dirname(fileURLToPath(import.meta.url))

export type RecallAttuneIntent
  = | { operation: 'remember', content: string, evidenceIds: string[] }
    | { operation: 'forget', id: string }

export async function executeRecallAttune(input: {
  context: RecallInvocationContext
  code: string
  timeoutMs?: number
}) {
  return await evaluateCell({
    program: input.code,
    timeoutMs: input.timeoutMs,
    runnerPath: resolve(localModuleDir, 'attune-runner.ts'),
    runnerUsesTsx: true,
    runnerInput: input.context,
  })
}
