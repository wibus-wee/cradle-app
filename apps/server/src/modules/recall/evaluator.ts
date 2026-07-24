import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateCell } from '../javascript-eval/evaluator'

export interface RecallInvocationContext {
  chatSessionId: string
  workspaceId: string
  workId: string | null
}

const localModuleDir = dirname(fileURLToPath(import.meta.url))

export async function executeRecallQuery(input: {
  context: RecallInvocationContext
  code: string
  timeoutMs?: number
}) {
  return await evaluateCell({
    program: input.code,
    timeoutMs: input.timeoutMs,
    runnerPath: resolve(localModuleDir, 'query-runner.ts'),
    runnerUsesTsx: true,
    runnerInput: input.context,
  })
}
