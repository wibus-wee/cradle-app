import { Command } from 'commander'
import { z } from 'zod'

import { getCommandContext } from '../runtime/context'
import { printResult } from '../runtime/output'
import type { CliOutputFormat, CommandContext } from '../runtime/types'
import { resolveWorkspaceReference } from '../runtime/workspace-context'
import { readJavaScriptProgramSource } from './javascript-program'

const OutputFormatSchema = z.enum(['agent', 'auto', 'json', 'pretty', 'table', 'ndjson'])

const JsonFieldsOptionSchema = z.union([
  z.string()
    .transform(value => value.split(',').map(field => field.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1)),
  z.boolean().transform(() => undefined),
  z.undefined(),
])

const GithubReviewModeSchema = z.enum(['approved', 'changes-requested', 'reviewed'])
const IssueStatusAwaitModeSchema = z.enum(['all', 'any'])
const IssueStatusCategorySchema = z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'])

interface AwaitCommandOptions {
  chatSessionId?: string
  workspace?: string
  reason?: string
  expiresAt?: string
  format?: string
  json?: boolean | string
}

interface GithubCIOptions extends AwaitCommandOptions {
  pr?: string
  sha?: string
  runId?: string
}

interface GithubReviewOptions extends AwaitCommandOptions {
  pr?: string
  mode?: string
}

interface ManualAwaitOptions extends AwaitCommandOptions {
  reason: string
}

interface IssueAgentAwaitOptions extends AwaitCommandOptions {
  issue?: string[]
}

interface IssueStatusAwaitOptions extends AwaitCommandOptions {
  issue?: string[]
  mode?: string
  category?: string[]
  statusId?: string[]
  statusName?: string[]
}

interface JavascriptAwaitOptions extends AwaitCommandOptions {
  program?: string
  programFile?: string
}

interface RetryDeliveryOptions {
  resumeText?: string
  resumePayloadJson?: string
  format?: string
  json?: boolean | string
}

function findChild(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name)
}

function readChild(parent: Command, name: string, description: string): Command {
  const existing = findChild(parent, name)
  if (existing) {
    return existing
  }
  return parent.command(name).description(description)
}

function readRequiredValue(value: string | undefined, envName: string, optionName: string): string {
  const resolved = value?.trim() || process.env[envName]?.trim()
  if (!resolved) {
    throw new Error(`${optionName} is required. Pass ${optionName} or set ${envName}.`)
  }
  return resolved
}

function collectOptionValue(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

function readRequiredValues(values: string[] | undefined, optionName: string): string[] {
  const resolved = values?.map(value => value.trim()).filter(Boolean) ?? []
  if (resolved.length === 0) {
    throw new Error(`${optionName} is required. Pass ${optionName} at least once.`)
  }
  return resolved
}

function readOptionalNumber(value: string | undefined, optionName: string): number | null {
  if (value === undefined) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} must be a number.`)
  }
  return parsed
}

function readInteger(value: string | undefined, optionName: string): number | null {
  const parsed = readOptionalNumber(value, optionName)
  if (parsed === null) {
    return null
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`${optionName} must be an integer.`)
  }
  return parsed
}

function countValues(values: unknown[]): number {
  return values.filter(value => value !== undefined && value !== null).length
}

async function buildCommonCreateBody(context: CommandContext, options: AwaitCommandOptions): Promise<{
  chatSessionId: string
  workspaceId: string
  reason?: string
  expiresAt?: number
}> {
  const expiresAt = readOptionalNumber(options.expiresAt, '--expires-at')
  const workspaceId = await resolveWorkspaceReference(context, options.workspace)
  if (!workspaceId) {
    throw new Error('Could not resolve a workspace for --workspace. Pass a workspace name or id explicitly, set CRADLE_WORKSPACE_ID, or run this from an imported workspace directory.')
  }
  return {
    chatSessionId: readRequiredValue(options.chatSessionId, 'CRADLE_CHAT_SESSION_ID', '--chat-session-id'),
    workspaceId,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(expiresAt === null ? {} : { expiresAt }),
  }
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

async function createAwait(command: Command, body: Record<string, unknown>, outputOptions: AwaitCommandOptions): Promise<void> {
  const context = getCommandContext(command)
  const result = await context.request({
    body,
    method: 'post',
    path: {},
    query: {},
    template: '/session-awaits/',
  })

  printResult(result, buildOutputOptions(outputOptions))
}

export function registerSessionAwaitCommand(root: Command): void {
  const session = readChild(root, 'session', 'Manage chat sessions')
  const awaitCommand = readChild(session, 'await', 'Register and recover durable session awaits')

  awaitCommand
    .command('github-ci')
    .description('Wait for GitHub CI on a pull request, commit, or check run')
    .argument('<repo>', 'GitHub repository, for example owner/repo')
    .option('--pr <number>', 'Pull request number')
    .option('--sha <sha>', 'Commit SHA or ref')
    .option('--run-id <id>', 'GitHub check run ID')
    .option('--chat-session-id <id>', 'Chat session ID. Defaults to CRADLE_CHAT_SESSION_ID')
    .option('--workspace <name-or-id>', 'Workspace name or id. Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.')
    .option('--reason <text>', 'Visible wait reason')
    .option('--expires-at <unixSeconds>', 'Unix timestamp when this await expires')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (repo: string, options: GithubCIOptions, command: Command) => {
      const pr = readInteger(options.pr, '--pr')
      const runId = readInteger(options.runId, '--run-id')
      const targetCount = countValues([pr, options.sha, runId])
      if (targetCount !== 1) {
        throw new Error('Pass exactly one GitHub CI target: --pr, --sha, or --run-id.')
      }

      const filter = {
        repo,
        ...(pr === null ? {} : { pr }),
        ...(options.sha ? { sha: options.sha } : {}),
        ...(runId === null ? {} : { runs_id: runId }),
      }

      await createAwait(command, {
        ...(await buildCommonCreateBody(getCommandContext(command), options)),
        source: 'github-ci',
        filterJson: JSON.stringify(filter),
      }, options)
    })

  awaitCommand
    .command('github-review')
    .description('Wait for a GitHub pull request review signal')
    .argument('<repo>', 'GitHub repository, for example owner/repo')
    .requiredOption('--pr <number>', 'Pull request number')
    .requiredOption('--mode <mode>', 'Review mode: approved, changes-requested, reviewed')
    .option('--chat-session-id <id>', 'Chat session ID. Defaults to CRADLE_CHAT_SESSION_ID')
    .option('--workspace <name-or-id>', 'Workspace name or id. Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.')
    .option('--reason <text>', 'Visible wait reason')
    .option('--expires-at <unixSeconds>', 'Unix timestamp when this await expires')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (repo: string, options: GithubReviewOptions, command: Command) => {
      const pr = readInteger(options.pr, '--pr')
      if (pr === null) {
        throw new Error('--pr is required.')
      }

      const mode = GithubReviewModeSchema.parse(options.mode)
      await createAwait(command, {
        ...(await buildCommonCreateBody(getCommandContext(command), options)),
        source: 'github-review',
        filterJson: JSON.stringify({ repo, pr, mode }),
      }, options)
    })

  awaitCommand
    .command('issue-agent')
    .description('Wait for delegated Cradle issue-agent work to return')
    .option('--issue <id>', 'Issue ID to await. May be repeated.', collectOptionValue, [])
    .option('--chat-session-id <id>', 'Chat session ID. Defaults to CRADLE_CHAT_SESSION_ID')
    .option('--workspace <name-or-id>', 'Workspace name or id. Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.')
    .option('--reason <text>', 'Visible wait reason')
    .option('--expires-at <unixSeconds>', 'Unix timestamp when this await expires')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (options: IssueAgentAwaitOptions, command: Command) => {
      await createAwait(command, {
        ...(await buildCommonCreateBody(getCommandContext(command), options)),
        source: 'cradle-issue-agent',
        filterJson: JSON.stringify({
          issueIds: readRequiredValues(options.issue, '--issue'),
          mode: 'all-current-delegations',
        }),
      }, options)
    })

  awaitCommand
    .command('issue-status')
    .description('Wait for Cradle issues to reach a workflow status condition')
    .option('--issue <id>', 'Issue ID to await. May be repeated.', collectOptionValue, [])
    .option('--mode <mode>', 'Match mode: all or any', 'all')
    .option('--category <category>', 'Target status category. May be repeated.', collectOptionValue, [])
    .option('--status-id <id>', 'Target status ID. May be repeated.', collectOptionValue, [])
    .option('--status-name <name>', 'Target status name. May be repeated.', collectOptionValue, [])
    .option('--chat-session-id <id>', 'Chat session ID. Defaults to CRADLE_CHAT_SESSION_ID')
    .option('--workspace <name-or-id>', 'Workspace name or id. Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.')
    .option('--reason <text>', 'Visible wait reason')
    .option('--expires-at <unixSeconds>', 'Unix timestamp when this await expires')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (options: IssueStatusAwaitOptions, command: Command) => {
      const categories = options.category?.map(category => IssueStatusCategorySchema.parse(category))
      const statusIds = options.statusId
      const statusNames = options.statusName
      const targetCount = countValues([
        categories && categories.length > 0 ? categories : undefined,
        statusIds && statusIds.length > 0 ? statusIds : undefined,
        statusNames && statusNames.length > 0 ? statusNames : undefined,
      ])
      if (targetCount !== 1) {
        throw new Error('Pass exactly one issue status target: --category, --status-id, or --status-name.')
      }

      await createAwait(command, {
        ...(await buildCommonCreateBody(getCommandContext(command), options)),
        source: 'cradle-issue-status',
        filterJson: JSON.stringify({
          issueIds: readRequiredValues(options.issue, '--issue'),
          mode: IssueStatusAwaitModeSchema.parse(options.mode),
          ...(categories && categories.length > 0 ? { categories } : {}),
          ...(statusIds && statusIds.length > 0 ? { statusIds } : {}),
          ...(statusNames && statusNames.length > 0 ? { statusNames } : {}),
        }),
      }, options)
    })

  awaitCommand
    .command('javascript')
    .description('Wait on a JavaScript cell that is re-evaluated until it completes')
    .option('--program <source>', 'Inline JavaScript cell (a bare async function or an ES module with a default export)')
    .option('--program-file <path>', 'Read the JavaScript cell source from a file')
    .option('--chat-session-id <id>', 'Chat session ID. Defaults to CRADLE_CHAT_SESSION_ID')
    .option('--workspace <name-or-id>', 'Workspace name or id. Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.')
    .option('--reason <text>', 'Visible wait reason')
    .option('--expires-at <unixSeconds>', 'Unix timestamp when this await expires')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (options: JavascriptAwaitOptions, command: Command) => {
      const program = readJavaScriptProgramSource(options)
      await createAwait(command, {
        ...(await buildCommonCreateBody(getCommandContext(command), options)),
        source: 'javascript',
        filterJson: JSON.stringify({ program }),
      }, options)
    })

  awaitCommand
    .command('manual')
    .description('Register a manual trigger-only session await')
    .requiredOption('--reason <text>', 'Visible wait reason')
    .option('--chat-session-id <id>', 'Chat session ID. Defaults to CRADLE_CHAT_SESSION_ID')
    .option('--workspace <name-or-id>', 'Workspace name or id. Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.')
    .option('--expires-at <unixSeconds>', 'Unix timestamp when this await expires')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (options: ManualAwaitOptions, command: Command) => {
      await createAwait(command, {
        ...(await buildCommonCreateBody(getCommandContext(command), options)),
        source: 'manual',
        filterJson: '{}',
      }, options)
    })

  awaitCommand
    .command('retry')
    .description('Retry delivery for a failed session await')
    .argument('<await-id>', 'Session await ID')
    .option('--resume-text <text>', 'Replacement resume message')
    .option('--resume-payload-json <json>', 'Replacement resume payload JSON')
    .option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
    .option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')
    .action(async (awaitId: string, options: RetryDeliveryOptions, command: Command) => {
      const context = getCommandContext(command)
      const result = await context.request({
        body: {
          ...(options.resumeText === undefined ? {} : { resumeText: options.resumeText }),
          ...(options.resumePayloadJson === undefined ? {} : { resumePayloadJson: options.resumePayloadJson }),
        },
        method: 'post',
        path: { id: awaitId },
        query: {},
        template: '/session-awaits/{id}/retry-delivery',
      })

      printResult(result, buildOutputOptions(options))
    })
}
