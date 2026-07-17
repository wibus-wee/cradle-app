import { readFileSync } from 'node:fs'

import { Command } from 'commander'
import { z } from 'zod'

import { getCommandContext } from '../runtime/context'
import { printResult } from '../runtime/output'
import type { CliOutputFormat } from '../runtime/types'

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

// Same source handling as `session await javascript`: exactly one of
// --program/--program-file, bare function expressions are wrapped as a
// default-exporting ES module (the server-side contract).
function readJavaScriptProgramSource(options: { program?: string, programFile?: string }): string {
  const hasProgram = options.program !== undefined
  const hasProgramFile = options.programFile !== undefined
  if (hasProgram === hasProgramFile) {
    throw new Error('Pass exactly one program input: --program or --program-file.')
  }
  let source: string
  if (hasProgramFile) {
    try {
      source = readFileSync(options.programFile!, 'utf8')
    }
    catch (err) {
      throw new Error(`Could not read --program-file ${options.programFile}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  else {
    source = options.program!
  }
  return source.includes('export default') ? source : `export default ${source}`
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
    .option('--program <source>', 'JavaScript cell source (an ES module with a default export, or a bare async function expression)')
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
