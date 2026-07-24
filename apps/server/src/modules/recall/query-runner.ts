import { writeFile } from 'node:fs/promises'

import { z } from 'zod'

import {
  context,
  failures,
  fileHistory,
  memories,
  overview,
  runs,
  search,
  thread,
} from './query-service'

const RunnerInputSchema = z.object({
  chatSessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  workId: z.string().min(1).nullable(),
})

const RequestSchema = z.object({
  program: z.string(),
  runnerInput: RunnerInputSchema,
})

type RunnerReply
  = | { kind: 'completed', result?: unknown }
    | { kind: 'program-error', error: string }
    | { kind: 'execution-error', error: string }

async function writeReply(reply: RunnerReply): Promise<void> {
  const resultPath = process.env.CRADLE_JAVASCRIPT_EVAL_RESULT_PATH
  if (!resultPath) {
    throw new Error('CRADLE_JAVASCRIPT_EVAL_RESULT_PATH is required')
  }
  await writeFile(resultPath, JSON.stringify(reply), 'utf8')
}

async function readRequest(): Promise<z.infer<typeof RequestSchema>> {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += chunk
  }
  return RequestSchema.parse(JSON.parse(raw))
}

function readErrorMessage(error: Error): string {
  return error.stack ?? error.message
}

async function main(): Promise<void> {
  let request: z.infer<typeof RequestSchema>
  try {
    request = await readRequest()
  }
 catch (error) {
    await writeReply({
      kind: 'program-error',
      error: readErrorMessage(error instanceof Error ? error : new Error(String(error))),
    })
    return
  }

  const scope = {
    workspaceId: request.runnerInput.workspaceId,
  }
  Object.assign(globalThis, {
    __cradleRecall: Object.freeze({
      overview: (options?: { limit?: number }) => ({
        ...overview(scope, options),
        currentSessionId: request.runnerInput.chatSessionId,
      }),
      search: (text: string, options?: {
        sessionId?: string
        limit?: number
        includeSidechains?: boolean
        includeMeta?: boolean
      }) => search(scope, text, options),
      context: (messageId: string) => context(scope, messageId),
      thread: (sessionId: string, options?: { limit?: number, includeSidechains?: boolean }) =>
        thread(scope, sessionId, options),
      failures: (options?: { sessionId?: string, limit?: number }) => failures(scope, options),
      fileHistory: (path: string, options?: { sessionId?: string, limit?: number }) =>
        fileHistory(scope, path, options),
      runs: (options?: { sessionId?: string, limit?: number }) => runs(scope, options),
      memories: (options?: { query?: string, limit?: number }) => memories(scope, options),
    }),
  })

  const prelude
    = 'const { overview, search, context, thread, failures, fileHistory, runs, memories } = globalThis.__cradleRecall;\n'
  try {
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${prelude}${request.program}`, 'utf8').toString('base64')}`
    const module = await import(moduleUrl)
    if (typeof module.default !== 'function') {
      await writeReply({ kind: 'program-error', error: 'Program must export a default function.' })
      return
    }
    const result = await module.default()
    structuredClone(result)
    await writeReply({ kind: 'completed', result })
  }
 catch (error) {
    await writeReply({
      kind: 'execution-error',
      error: readErrorMessage(error instanceof Error ? error : new Error(String(error))),
    })
  }
}

void main()
