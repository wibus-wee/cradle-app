import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Command } from 'commander'
import { z } from 'zod'

import { getCommandContext } from '../runtime/context'
import { printResult } from '../runtime/output'
import type { CliOutputFormat, CommandContext } from '../runtime/types'

const runFile = promisify(execFile)

const OutputFormatSchema = z.enum(['agent', 'auto', 'json', 'pretty', 'table', 'ndjson'])

const JsonFieldsOptionSchema = z.union([
  z.string()
    .transform(value => value.split(',').map(field => field.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1)),
  z.boolean().transform(() => undefined),
  z.undefined(),
])

const WorkspaceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  locator: z.object({
    hostId: z.string(),
    path: z.string(),
  }).passthrough(),
}).passthrough()

export interface OpenCommandOptions {
  importOnly?: boolean
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

/**
 * Expand a user-facing path argument into an absolute filesystem path.
 * Supports `.`, `..`, `~`, and relative segments.
 */
export function expandOpenPath(input: string | undefined, cwd = process.cwd()): string {
  const raw = (input?.trim() || '.')
  if (raw === '~') {
    return homedir()
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return resolve(homedir(), raw.slice(2))
  }
  if (isAbsolute(raw)) {
    return resolve(raw)
  }
  return resolve(cwd, raw)
}

/**
 * Whether a top-level CLI token should be treated as a path sugar for `open`
 * instead of a module name. Known commands are never stolen.
 */
export function looksLikeOpenPathArg(value: string, knownCommands: ReadonlySet<string>): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('-')) {
    return false
  }
  if (knownCommands.has(trimmed)) {
    return false
  }
  if (trimmed === '.' || trimmed === '..') {
    return true
  }
  if (trimmed.startsWith('~/') || trimmed === '~' || trimmed.startsWith('~\\')) {
    return true
  }
  if (isAbsolute(trimmed)) {
    return true
  }
  // Relative path-like tokens: contain a path separator or end with /.
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return true
  }
  // Bare relative directory name only when it exists as a directory in cwd.
  try {
    const candidate = resolve(process.cwd(), trimmed)
    return existsSync(candidate) && statSync(candidate).isDirectory()
  }
  catch {
    return false
  }
}

export function buildOpenWorkspaceDeepLink(workspaceId: string): string {
  const id = workspaceId.trim()
  if (!id) {
    throw new Error('workspaceId is required for open deep link')
  }
  return `cradle://open/workspace?id=${encodeURIComponent(id)}`
}

function assertDirectory(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Path does not exist: ${path}`)
  }
  let isDirectory = false
  try {
    isDirectory = statSync(path).isDirectory()
  }
  catch (error) {
    throw new Error(`Cannot read path: ${path}${error instanceof Error ? ` (${error.message})` : ''}`)
  }
  if (!isDirectory) {
    throw new Error(`Path is not a directory: ${path}`)
  }
}

async function resolveExistingWorkspace(
  context: CommandContext,
  path: string,
): Promise<z.infer<typeof WorkspaceRecordSchema> | null> {
  try {
    const resolved = await context.request({
      method: 'get',
      path: {},
      query: { hostId: 'local', path },
      template: '/workspaces/resolve',
    })
    if (resolved == null) {
      return null
    }
    return WorkspaceRecordSchema.parse(resolved)
  }
  catch {
    return null
  }
}

async function ensureWorkspaceFromDirectory(
  context: CommandContext,
  path: string,
): Promise<z.infer<typeof WorkspaceRecordSchema>> {
  try {
    const result = await context.request({
      body: { path },
      method: 'post',
      path: {},
      query: {},
      template: '/workspaces/from-directory',
    })
    return WorkspaceRecordSchema.parse(result)
  }
  catch (error) {
    // Older servers returned 409 on re-import. Resolve the existing workspace
    // so `cradle open` stays idempotent across server versions.
    const message = error instanceof Error ? error.message : String(error)
    if (!/already exists|workspace_locator_exists/i.test(message)) {
      throw error
    }
    const existing = await resolveExistingWorkspace(context, path)
    if (!existing) {
      throw error
    }
    return existing
  }
}

/**
 * Open a cradle:// URL with the OS protocol handler so Desktop focuses (or
 * launches) and handles navigation. On macOS `open` is preferred; elsewhere we
 * fall back to `xdg-open` / `cmd start`.
 */
export async function openCradleDeepLink(
  url: string,
  runner: typeof runFile = runFile,
): Promise<void> {
  if (process.platform === 'darwin') {
    await runner('open', [url])
    return
  }
  if (process.platform === 'win32') {
    await runner('cmd', ['/c', 'start', '', url])
    return
  }
  await runner('xdg-open', [url])
}

export async function runOpenCommand(
  context: CommandContext,
  pathArg: string | undefined,
  options: OpenCommandOptions,
  deps: {
    openDeepLink?: typeof openCradleDeepLink
  } = {},
): Promise<z.infer<typeof WorkspaceRecordSchema> & { opened: boolean, created: boolean }> {
  const absolutePath = expandOpenPath(pathArg)
  assertDirectory(absolutePath)

  // Probe first so we can report whether this open created a new registration.
  let alreadyImported = false
  try {
    const inspection = await context.request({
      body: { path: absolutePath },
      method: 'post',
      path: {},
      query: {},
      template: '/workspaces/inspect-directory',
    })
    alreadyImported = z.object({ alreadyImported: z.boolean() }).parse(inspection).alreadyImported
  }
  catch {
    // Inspect is best-effort; import is still authoritative and idempotent.
  }

  const workspace = await ensureWorkspaceFromDirectory(context, absolutePath)
  const shouldOpenUi = !options.importOnly
  if (shouldOpenUi) {
    const openDeepLink = deps.openDeepLink ?? openCradleDeepLink
    try {
      await openDeepLink(buildOpenWorkspaceDeepLink(workspace.id))
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Workspace is registered (${workspace.name}), but Cradle Desktop could not be opened: ${detail}. `
        + 'Is Cradle installed and is the cradle:// protocol registered?',
      )
    }
  }

  return {
    ...workspace,
    opened: shouldOpenUi,
    created: !alreadyImported,
  }
}

export function registerOpenCommand(root: Command): void {
  root
    .command('open')
    .description('Register a directory as a Cradle workspace (if needed) and open it in Desktop')
    .argument('[path]', 'Directory to open (default: current directory)', '.')
    .option('--import-only', 'Register the workspace without opening Desktop')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (pathArg: string | undefined, options: OpenCommandOptions, command: Command) => {
      const context = getCommandContext(command)
      const result = await runOpenCommand(context, pathArg, options)
      printResult(result, buildOutputOptions(options))
    })
}

// path.sep without pulling the full path module for a boot-time argv helper
const pathSep = process.platform === 'win32' ? '\\' : '/'

/**
 * Split process-like argv into runtime prefix + user args.
 *
 * Handles:
 * - node script.js ...
 * - node tsx script.ts ...  (pnpm cradle / tsx src/index.ts)
 * - pure user argv from tests ({ from: 'user' })
 * - pnpm/npm inserted `--` separators
 */
export function splitCliArgv(argv: string[]): { prefix: string[], user: string[] } {
  if (argv.length === 0) {
    return { prefix: [], user: [] }
  }

  const looksLikeRuntime = argv[0] === process.execPath
    || argv[0]!.endsWith('node')
    || argv[0]!.includes(`${pathSep}node`)
    || /(?:^|[/\\])node(?:\.exe)?$/i.test(argv[0]!)

  if (!looksLikeRuntime) {
    return { prefix: [], user: [...argv] }
  }

  // Find the CLI entry script — the last runtime-ish token before user input.
  // Under tsx: [node, .../tsx, src/index.ts, ...user]
  // Under node dist: [node, .../dist/index.js, ...user]
  let scriptIndex = -1
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!
    if (token === '--') {
      // Everything after runtime `--` is user input; script should be just before if present.
      break
    }
    if (
      token.endsWith('index.ts')
      || token.endsWith('index.js')
      || token.endsWith(`${pathSep}index.ts`)
      || token.endsWith(`${pathSep}index.js`)
      || /[/\\]packages[/\\]cli[/\\](?:src|dist)[/\\]index\.(?:ts|js)$/.test(token)
      || token.includes(`${pathSep}cli${pathSep}src${pathSep}index.`)
      || token.includes(`${pathSep}cli${pathSep}dist${pathSep}index.`)
    ) {
      scriptIndex = i
    }
  }

  if (scriptIndex >= 0) {
    return {
      prefix: argv.slice(0, scriptIndex + 1),
      user: argv.slice(scriptIndex + 1),
    }
  }

  // Fallback: classic [node, script, ...user]
  return {
    prefix: argv.slice(0, Math.min(2, argv.length)),
    user: argv.slice(Math.min(2, argv.length)),
  }
}

/**
 * When the first positional looks like a filesystem path and is not a known
 * top-level command, rewrite argv so `cradle .` becomes `cradle open .`.
 * Must run before commander parses so module commands still win.
 */
export function applyOpenPathSugar(argv: string[], knownCommands: ReadonlySet<string>): string[] {
  const { prefix, user } = splitCliArgv(argv)
  if (user.length === 0) {
    return argv
  }

  // Drop leading `--` separators inserted by pnpm/npm (`pnpm cradle -- open .`).
  let working = [...user]
  while (working[0] === '--') {
    working = working.slice(1)
  }
  if (working.length === 0) {
    return prefix.length === 0 ? working : [...prefix, ...working]
  }

  // Skip global options before the first positional.
  let index = 0
  while (index < working.length) {
    const token = working[index]!
    if (token === '--') {
      index += 1
      break
    }
    if (token.startsWith('-')) {
      // Options that take a value: --server <url>
      if (token === '--server' || token === '-s') {
        index += 2
        continue
      }
      if (token.startsWith('--server=')) {
        index += 1
        continue
      }
      index += 1
      continue
    }
    break
  }

  const firstPositional = working[index]
  if (!firstPositional || !looksLikeOpenPathArg(firstPositional, knownCommands)) {
    return prefix.length === 0 ? working : [...prefix, ...working]
  }

  const rewrittenUser = [
    ...working.slice(0, index),
    'open',
    ...working.slice(index),
  ]
  return prefix.length === 0 ? rewrittenUser : [...prefix, ...rewrittenUser]
}
