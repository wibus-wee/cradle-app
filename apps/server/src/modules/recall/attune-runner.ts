import { writeFile } from 'node:fs/promises'

import { z } from 'zod'

const RequestSchema = z.object({
  program: z.string(),
  runnerInput: z.object({
    chatSessionId: z.string().min(1),
    workspaceId: z.string().min(1),
    workId: z.string().min(1).nullable(),
  }),
})

const RememberSchema = z.object({ content: z.string().min(1), evidenceIds: z.array(z.string().min(1)).min(1) })

type Reply
  = | { kind: 'completed', result: unknown }
    | { kind: 'program-error', error: string }
    | { kind: 'execution-error', error: string }

async function reply(value: Reply): Promise<void> {
  const resultPath = process.env.CRADLE_JAVASCRIPT_EVAL_RESULT_PATH
  if (!resultPath) { throw new Error('CRADLE_JAVASCRIPT_EVAL_RESULT_PATH is required') }
  await writeFile(resultPath, JSON.stringify(value), 'utf8')
}

async function main(): Promise<void> {
  try {
    let raw = ''
    for await (const chunk of process.stdin) { raw += chunk }
    const request = RequestSchema.parse(JSON.parse(raw))
    const intents: unknown[] = []
    Object.assign(globalThis, {
      __cradleRecallAttune: Object.freeze({
        remember: (content: string, evidenceIds: string[]) => intents.push({ operation: 'remember', content, evidenceIds }),
        forget: (id: string) => intents.push({ operation: 'forget', id }),
      }),
    })
    const prelude = 'const { remember, forget } = globalThis.__cradleRecallAttune;\n'
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(`${prelude}${request.program}`, 'utf8').toString('base64')}`
    const module = await import(moduleUrl)
    if (typeof module.default !== 'function') {
      await reply({ kind: 'program-error', error: 'Program must export a default function.' })
      return
    }
    await module.default()
    if (intents.length !== 1) {
      await reply({ kind: 'program-error', error: 'Attune program must request exactly one remember() or forget() operation.' })
      return
    }
    const intent = intents[0] as { operation?: unknown, content?: unknown, evidenceIds?: unknown, id?: unknown }
    if (intent.operation === 'remember') {
      await reply({ kind: 'completed', result: { operation: 'remember', ...RememberSchema.parse(intent) } })
      return
    }
    if (intent.operation === 'forget' && typeof intent.id === 'string' && intent.id.trim()) {
      await reply({ kind: 'completed', result: { operation: 'forget', id: intent.id.trim() } })
      return
    }
    await reply({ kind: 'program-error', error: 'Invalid attune operation.' })
  }
  catch (error) {
    await reply({ kind: 'execution-error', error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
}

void main()
