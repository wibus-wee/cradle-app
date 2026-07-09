import { Command } from 'commander'
import { z } from 'zod'

import { getCommandContext } from './context'
import { printResult } from './output'
import type { CliOperationSpec, CliOutputFormat, CliValueType, CommandContext } from './types'
import { resolveWorkspaceReference } from './workspace-context'

const OutputFormatSchema = z.enum(['agent', 'auto', 'json', 'pretty', 'table', 'ndjson'])
const CliHttpMethodSchema = z.enum(['delete', 'get', 'patch', 'post', 'put'])
const CliValueTypeSchema = z.enum(['boolean', 'json', 'number', 'string', 'string[]'])
const CliResolverSchema = z.enum(['workspace'])
const CliArgumentSpecSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  envDefault: z.string().optional(),
  flagName: z.string().optional(),
  resolver: CliResolverSchema.optional(),
  resolverAmbient: z.boolean().optional(),
  target: z.string(),
  required: z.boolean().optional(),
  type: CliValueTypeSchema.default('string'),
})
const CliFlagSpecSchema = CliArgumentSpecSchema.extend({
  disableResolverFlag: z.string().optional(),
  values: z.array(z.string()).optional(),
})
const CliOperationSpecSchema = z.object({
  command: z.array(z.string()).min(1),
  description: z.string().optional(),
  method: CliHttpMethodSchema,
  path: z.string(),
  arguments: z.array(CliArgumentSpecSchema).default([]),
  flags: z.array(CliFlagSpecSchema).default([]),
})

const JsonFieldsOptionSchema = z.union([
  z.string()
    .transform(value => value.split(',').map(field => field.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1)),
  z.boolean().transform(() => undefined),
  z.undefined(),
])

const CliValueSchemas = {
  string: z.string().optional(),
  number: z.coerce.number().optional(),
  boolean: z.boolean().optional(),
  'string[]': z.union([
    z.array(z.string()),
    z.string().transform(value => value.split(',').map(item => item.trim()).filter(Boolean)),
  ]).optional(),
  json: z.string().transform(value => JSON.parse(value)).optional(),
} satisfies Record<CliValueType, z.ZodTypeAny>

function parseBooleanValue(value: unknown): boolean | undefined {
  if (value === undefined) { return undefined }
  if (typeof value === 'boolean') { return value }
  if (value === 'true') { return true }
  if (value === 'false') { return false }
  throw new Error('Expected a boolean')
}

function parseCliValue(type: CliValueType, value: unknown): unknown {
  if (type === 'boolean') {
    return parseBooleanValue(value)
  }
  return CliValueSchemas[type].parse(value)
}

function readEnvDefault(envName: string | undefined): string | undefined {
  if (!envName) {
    return undefined
  }
  return process.env[envName]?.trim() || undefined
}

async function resolveFieldValue(input: {
  context: CommandContext
  envDefault?: string
  optionName: string
  required?: boolean
  resolver?: 'workspace'
  resolverAmbient?: boolean
  type: CliValueType
  value: unknown
}): Promise<unknown> {
  if (input.resolver === 'workspace' && input.type === 'string') {
    const explicit = typeof input.value === 'string' ? input.value : undefined
    const resolved = await resolveWorkspaceReference(input.context, explicit, { ambient: input.resolverAmbient })
    if (resolved === undefined && input.required) {
      throw new Error(
        `Could not resolve a workspace for ${input.optionName}. Pass a workspace name or id explicitly, set CRADLE_WORKSPACE_ID, or run this from an imported workspace directory.`,
      )
    }
    return resolved
  }

  const value = input.value ?? readEnvDefault(input.envDefault)
  const parsed = parseCliValue(input.type, value)
  if (parsed === undefined && input.required) {
    const envHint = input.envDefault ? ` or set ${input.envDefault}` : ''
    throw new Error(`${input.optionName} is required. Pass ${input.optionName}${envHint}.`)
  }
  return parsed
}

function findSubcommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name)
}

const UPPER_CASE_RE = /[A-Z]/g

function toKebabCase(value: string): string {
  return value.replace(UPPER_CASE_RE, char => `-${char.toLowerCase()}`)
}

function describeGroup(name: string): string | undefined {
  const descriptions: Record<string, string> = {
    'acp': 'Manage ACP agents',
    'agent': 'Manage Cradle agents',
    'automation': 'Manage scheduled automations',
    'board': 'Manage kanban boards',
    'branch': 'Manage git branches',
    'chat': 'Manage chat runtime commands',
    'chronicle': 'Inspect Chronicle memory and activity',
    'comment': 'Manage issue comments',
    'context': 'Manage context references',
    'context-ref': 'Manage issue context references',
    'cost': 'Inspect usage costs',
    'document': 'Manage documents',
    'export': 'Export resources',
    'external-issue-source': 'Manage external issue sources',
    'file': 'Manage workspace files',
    'field-change': 'Inspect issue field changes',
    'diffs': 'Manage workspace diff reviews',
    'folder': 'Manage workspace folders',
    'git': 'Manage workspace git state',
    'link-preview': 'Preview links',
    'issue': 'Manage kanban issues',
    'issue-agent-session': 'Manage issue agent sessions',
    'linked-issue': 'Manage session issue links',
    'milestone': 'Manage kanban milestones',
    'observability': 'Inspect observability data',
    'plugin': 'Manage Cradle plugins',
    'preferences': 'Manage server preferences',
    'profile': 'Manage agent profiles',
    'provider': 'Inspect providers',
    'relation': 'Manage issue relations',
    'relay-server': 'Manage relay servers',
    'remote-host': 'Manage remote hosts',
    'search': 'Search Cradle data',
    'secret': 'Manage secret metadata',
    'session': 'Manage chat sessions',
    'skill': 'Manage skills',
    'source': 'Manage external sources',
    'status': 'Manage kanban statuses',
    'usage': 'Inspect usage data',
    'workflow': 'Manage workflow rules',
    'workflow-rule': 'Manage workflow rules',
    'workspace': 'Manage workspaces',
  }
  return descriptions[name]
}

function getOrCreateGroup(parent: Command, name: string): Command {
  const existing = findSubcommand(parent, name)
  if (existing) {
    return existing
  }
  const command = parent.command(name)
  const description = describeGroup(name)
  if (description) {
    command.description(description)
  }
  return command
}

function setTarget(target: string, value: unknown, containers: {
  body: Record<string, unknown>
  path: Record<string, unknown>
  query: Record<string, unknown>
}): void {
  const [scope, key] = target.split('.')
  if (!scope || !key) {
    throw new Error(`Invalid CLI target: ${target}`)
  }
  if (scope !== 'body' && scope !== 'path' && scope !== 'query') {
    throw new Error(`Unsupported CLI target scope: ${scope}`)
  }
  containers[scope][key] = value
}

function hasValues(record: Record<string, unknown>): boolean {
  return Object.values(record).some(value => value !== undefined)
}

export function registerOperationCommand(root: Command, rawSpec: CliOperationSpec): void {
  const spec = CliOperationSpecSchema.parse(rawSpec)
  const segments = spec.command

  let parent = root
  for (const segment of segments.slice(0, -1)) {
    parent = getOrCreateGroup(parent, segment)
  }

  const leaf = new Command(segments.at(-1)!)
  leaf.description(spec.description ?? `${spec.method.toUpperCase()} ${spec.path}`)
  leaf.option('--format <format>', 'Output format: agent, auto, json, pretty, table, ndjson', 'auto')
  leaf.option('--json [fields]', 'Print JSON, optionally selecting comma-separated fields')

  for (const argument of spec.arguments) {
    const hasAmbientFallback = argument.resolver !== undefined && argument.resolverAmbient !== false
    const label = argument.flagName ?? argument.name
    const name = argument.required === false || hasAmbientFallback ? `[${label}]` : `<${label}>`
    leaf.argument(name, argument.description)
  }

  const disableResolverFlags = new Map<string, string>()
  for (const flag of spec.flags) {
    const flagLabel = toKebabCase(flag.flagName ?? flag.name)
    const description = flag.values?.length
      ? `${flag.description ?? ''}${flag.description ? ' ' : ''}Allowed: ${flag.values.join(', ')}`
      : flag.description
    const option = flag.type === 'boolean' && flag.required
      ? `--${flagLabel} <value>`
      : flag.type === 'boolean'
        ? `--${flagLabel}`
        : `--${flagLabel} <value>`
    const hasFallback = flag.envDefault !== undefined || flag.resolver !== undefined
    if (flag.required && !hasFallback) {
      leaf.requiredOption(option, description)
    }
    else {
      leaf.option(option, description)
      if (flag.type === 'boolean') {
        leaf.option(`--no-${flagLabel}`, description)
      }
    }
    if (flag.disableResolverFlag) {
      const disableOptionName = toKebabCase(flag.disableResolverFlag)
      if (!disableResolverFlags.has(flag.disableResolverFlag)) {
        leaf.option(`--${disableOptionName}`, `Do not resolve --${flagLabel} automatically`)
        disableResolverFlags.set(flag.disableResolverFlag, flag.name)
      }
    }
  }

  leaf.action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command
    const opts = command.opts<Record<string, unknown> & { format?: string, json?: boolean | string }>()
    const containers = { body: {}, path: {}, query: {} } as {
      body: Record<string, unknown>
      path: Record<string, unknown>
      query: Record<string, unknown>
    }

    const context = getCommandContext(command)

    for (const [index, argument] of spec.arguments.entries()) {
      setTarget(
        argument.target,
        await resolveFieldValue({
          context,
          envDefault: argument.envDefault,
          optionName: `<${argument.flagName ?? argument.name}>`,
          required: argument.required,
          resolver: argument.resolver,
          resolverAmbient: argument.resolverAmbient,
          type: argument.type,
          value: args[index],
        }),
        containers,
      )
    }

    for (const flag of spec.flags) {
      // Commander derives `opts` keys from the flag it actually registered
      // (`flagName ?? name`, e.g. `--workspace` -> opts.workspace), which can
      // differ from the internal API field name (`name`, e.g. `workspaceId`).
      const optionKey = flag.flagName ?? flag.name
      const flagLabel = toKebabCase(optionKey)
      const skipResolution = flag.disableResolverFlag !== undefined && opts[flag.disableResolverFlag] === true

      if (
        flag.disableResolverFlag
        && opts[flag.disableResolverFlag] === true
        && opts[optionKey] !== undefined
      ) {
        throw new Error(`--${flagLabel} cannot be used with --${toKebabCase(flag.disableResolverFlag)}.`)
      }

      setTarget(
        flag.target,
        await resolveFieldValue({
          context,
          envDefault: flag.envDefault,
          optionName: `--${flagLabel}`,
          required: flag.required,
          resolver: skipResolution ? undefined : flag.resolver,
          resolverAmbient: flag.resolverAmbient,
          type: flag.type,
          value: opts[optionKey],
        }),
        containers,
      )
    }

    const result = await context.request({
      body: hasValues(containers.body) ? containers.body : undefined,
      method: spec.method,
      path: containers.path,
      query: containers.query,
      template: spec.path,
    })

    printResult(result, {
      forceJson: opts.json !== undefined,
      format: OutputFormatSchema.parse(opts.format) satisfies CliOutputFormat,
      jsonFields: JsonFieldsOptionSchema.parse(opts.json),
    })
  })

  parent.addCommand(leaf)
}
