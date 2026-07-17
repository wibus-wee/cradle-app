import { Command } from 'commander'
import { z } from 'zod'

import { getCommandContext } from '../runtime/context'
import { printResult } from '../runtime/output'
import type { CliOutputFormat } from '../runtime/types'
import { readJavaScriptProgramSource } from './javascript-program'

const OutputFormatSchema = z.enum(['agent', 'auto', 'json', 'pretty', 'table', 'ndjson'])

const JsonFieldsOptionSchema = z.union([
  z.string()
    .transform(value => value.split(',').map(field => field.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1)),
  z.boolean().transform(() => undefined),
  z.undefined(),
])

interface JavascriptEvaluateOptions {
  program?: string
  programFile?: string
  cwd?: string
  timeoutMs?: string
  format?: string
  json?: boolean | string
}

function buildOutputOptions(options: { format?: string, json?: boolean | string }): {
  forceJson: boolean
  format: CliOutputFormat
  jsonFields?: string[]
} {
  return {
    forceJson: options.json !== undefined,
    format: OutputFormatSchema.parse(options.format ?? 'auto'),
    jsonFields: JsonFieldsOptionSchema.parse(options.json),
  }
}

function readTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error('--timeout-ms must be a number.')
  }
  return parsed
}

export function registerJavascriptCommand(root: Command): void {
  const javascript = root
    .command('javascript')
    .description('Evaluate JavaScript cells on the Cradle server')

  javascript
    .command('evaluate')
    .description('Evaluate a JavaScript cell once and print the result')
    .option('--program <source>', 'Inline JavaScript cell (a bare async function or an ES module with a default export)')
    .option('--program-file <path>', 'Read the JavaScript cell source from a file')
    .option('--cwd <path>', 'Working directory for tools.exec inside the cell')
    .option('--timeout-ms <n>', 'Wall-clock evaluation timeout in milliseconds')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (options: JavascriptEvaluateOptions, command: Command) => {
      const program = readJavaScriptProgramSource(options)
      const timeoutMs = readTimeoutMs(options.timeoutMs)
      const context = getCommandContext(command)
      const result = await context.request({
        body: {
          program,
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        method: 'post',
        path: {},
        query: {},
        template: '/javascript/evaluate',
      })

      printResult(result, buildOutputOptions(options))
    })
}
