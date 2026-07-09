import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServerContractApp } from '../../../apps/server/src/app'
import type { CliArgumentSpec, CliFlagSpec, CliOperationSpec, CliValueType } from '../src/runtime/types'

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put'

const KEBAB_TO_PASCAL_RE = /(^|-)([a-z])/g
const TS_EXTENSION_RE = /\.ts$/
const PIPE_RE = /\|/g

interface OpenApiSchema {
  anyOf?: OpenApiSchema[]
  const?: string
  description?: string
  enum?: string[]
  items?: OpenApiSchema
  oneOf?: OpenApiSchema[]
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  type?: string
}

interface OpenApiParameter {
  description?: string
  in: 'path' | 'query'
  name: string
  required?: boolean
  schema?: OpenApiSchema
}

interface OpenApiOperation {
  'parameters'?: OpenApiParameter[]
  'requestBody'?: {
    content?: Record<string, { schema?: OpenApiSchema }>
    required?: boolean
  }
  'summary'?: string
  'tags'?: string[]
  'x-cradle-cli'?: {
    command: string[]
    defaultWorkspaceId?: boolean
    hidden?: boolean
  }
}

interface OpenApiDocument {
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
}

const dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(dirname, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const generatedRoot = path.join(packageRoot, 'src', 'commands', 'generated')
const cradleCliSkillPath = path.join(repoRoot, 'resources', 'skills', 'cradle-cli', 'SKILL.md')
const generatedSkillStart = '<!-- CRADLE_CLI_MODULES_START -->'
const generatedSkillEnd = '<!-- CRADLE_CLI_MODULES_END -->'

const moduleDescriptions: Record<string, string> = {
  'acp': 'Manage ACP agent installation and registry state.',
  'agent': 'Manage Cradle agent identities.',
  'approval': 'Inspect and respond to pending approvals.',
  'automation': 'Manage scheduled automations, runs, and artifacts.',
  'board': 'Manage Kanban boards.',
  'chat': 'Control chat runtime commands.',
  'health': 'Check server health.',
  'issue': 'Manage Kanban issues, comments, relations, delegation, and context refs.',
  'issue-agent-session': 'Inspect and control issue agent sessions.',
  'milestone': 'Manage Kanban milestones.',
  'observability': 'Inspect local observability events, incidents, and exports.',
  'preferences': 'Read and update server preferences.',
  'profile': 'Manage agent profiles.',
  'provider': 'Inspect provider model availability.',
  'search': 'Search Cradle data.',
  'secret': 'Manage secret metadata.',
  'session': 'Manage chat sessions and session links.',
  'skill': 'Manage skills and skill sources.',
  'status': 'Manage Kanban statuses.',
  'usage': 'Inspect usage and cost data.',
  'workflow-rule': 'Manage workflow rules.',
  'workspace': 'Manage workspaces, files, and git helpers.',
}

function toGeneratedPath(command: string[]): string {
  return path.join(generatedRoot, ...command.slice(0, -1), `${command.at(-1)}.ts`)
}

function normalizeCommand(command: string[]): string[] {
  return command.map(segment => segment.trim()).filter(Boolean)
}

function unwrapSchema(schema: OpenApiSchema | undefined): OpenApiSchema | undefined {
  if (!schema?.anyOf) {
    return schema
  }
  return schema.anyOf.find(item => item.type !== 'null') ?? schema.anyOf[0]
}

function inferValueType(schema: OpenApiSchema | undefined): CliValueType {
  const unwrapped = unwrapSchema(schema)
  if (!unwrapped) {
    return 'string'
  }
  if (unwrapped.type === 'array') {
    if (unwrapSchema(unwrapped.items)?.type === 'object') {
      return 'json'
    }
    return 'string[]'
  }
  if (unwrapped.type === 'boolean') {
    return 'boolean'
  }
  if (unwrapped.type === 'integer' || unwrapped.type === 'number') {
    return 'number'
  }
  if (unwrapped.type === 'object') {
    return 'json'
  }
  const arrayVariant = unwrapped.anyOf?.map(unwrapSchema).find(item => item?.type === 'array')
  if (arrayVariant) {
    if (unwrapSchema(arrayVariant.items)?.type === 'object') {
      return 'json'
    }
    return 'string[]'
  }
  return 'string'
}

function getSchemaValues(schema: OpenApiSchema | undefined): string[] | undefined {
  const values = new Set<string>()

  function visit(candidate: OpenApiSchema | undefined): void {
    if (!candidate || candidate.type === 'null') {
      return
    }
    if (candidate.const) {
      values.add(candidate.const)
    }
    for (const value of candidate.enum ?? []) {
      values.add(value)
    }
    for (const variant of candidate.anyOf ?? []) {
      visit(variant)
    }
    for (const variant of candidate.oneOf ?? []) {
      visit(variant)
    }
  }

  visit(schema)
  return values.size > 0 ? Array.from(values) : undefined
}

function getJsonBodySchema(operation: OpenApiOperation): OpenApiSchema | undefined {
  return unwrapSchema(operation.requestBody?.content?.['application/json']?.schema)
}

/**
 * Turns a `workspaceId` path/query/body parameter into a human-resolvable
 * `--workspace <name-or-id>` flag (or `[workspace]`/`<workspace>` argument)
 * instead of a raw `--workspace-id <uuid>`. See
 * `packages/cli/src/runtime/workspace-context.ts` for the resolution chain.
 *
 * `ambient: false` is used for destructive/administrative path parameters
 * (e.g. `workspace delete`) that must never silently fall back to "whatever
 * the current workspace is" — those still accept a name instead of a raw id,
 * they just require it to be typed.
 */
function withWorkspaceResolver<T extends CliArgumentSpec | CliFlagSpec>(spec: T, options: { ambient?: boolean } = {}): T {
  if (spec.name !== 'workspaceId' || spec.type !== 'string') {
    return spec
  }

  const ambient = options.ambient !== false
  const hint = ambient
    ? 'Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.'
    : 'Accepts a workspace name or id.'

  return {
    ...spec,
    description: spec.description ? `${spec.description} ${hint}` : hint,
    flagName: 'workspace',
    resolver: 'workspace',
    resolverAmbient: ambient,
  }
}

function withWorkspaceQueryScopeFlag(flag: CliFlagSpec): CliFlagSpec {
  if (flag.name !== 'workspaceId' || flag.target !== 'query.workspaceId' || flag.required) {
    return flag
  }

  return {
    ...flag,
    description: `${flag.description ?? ''} Pass --all-workspaces to query every workspace.`.trim(),
    disableResolverFlag: 'allWorkspaces',
  }
}

function collectArguments(operation: OpenApiOperation): CliArgumentSpec[] {
  const ambientPathWorkspaceId = operation['x-cradle-cli']?.defaultWorkspaceId === true
  return (operation.parameters ?? [])
    .filter(parameter => parameter.in === 'path')
    .map(parameter => withWorkspaceResolver({
      description: parameter.description ?? parameter.schema?.description,
      name: parameter.name,
      required: parameter.required !== false,
      target: `path.${parameter.name}`,
      type: inferValueType(parameter.schema),
    }, { ambient: ambientPathWorkspaceId }))
}

function collectFlags(operation: OpenApiOperation): CliFlagSpec[] {
  const flags: CliFlagSpec[] = []

  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== 'query') {
      continue
    }
    flags.push(withWorkspaceQueryScopeFlag(withWorkspaceResolver({
      description: parameter.description ?? parameter.schema?.description,
      name: parameter.name,
      required: parameter.required === true,
      target: `query.${parameter.name}`,
      type: inferValueType(parameter.schema),
      values: getSchemaValues(parameter.schema),
    })))
  }

  const bodySchema = getJsonBodySchema(operation)
  if (bodySchema?.properties) {
    const required = new Set(bodySchema.required ?? [])
    for (const [name, schema] of Object.entries(bodySchema.properties)) {
      flags.push(withWorkspaceResolver({
        description: schema.description,
        name,
        required: required.has(name),
        target: `body.${name}`,
        type: inferValueType(schema),
        values: getSchemaValues(schema),
      }))
    }
  }

  return flags
}

function renderSpec(spec: CliOperationSpec): string {
  return JSON.stringify(spec, null, 2)
}

function renderCommandModule(spec: CliOperationSpec): string {
  const runtimePrefix = '../'.repeat(spec.command.length + 1)
  const runtimeImport = `${runtimePrefix}runtime/operation-command`
  const typeImport = `${runtimePrefix}runtime/types`

  return `import { registerOperationCommand } from '${runtimeImport}'
import type { CliOperationSpec } from '${typeImport}'
import type { Command } from 'commander'

const spec = ${renderSpec(spec)} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
`
}

function renderIndex(imports: Array<{ importName: string, relativePath: string }>): string {
  const importLines = imports
    .map(item => `import { register as ${item.importName} } from './${item.relativePath}'`)
    .join('\n')
  const callLines = imports
    .map(item => `  ${item.importName}(program)`)
    .join('\n')

  return `import type { Command } from 'commander'

${importLines}

export function registerGeneratedCommands(program: Command): void {
${callLines || '  void program'}
}
`
}

function createImportName(command: string[]): string {
  return `register${command.map(segment => segment.replace(KEBAB_TO_PASCAL_RE, (_, __, char: string) => char.toUpperCase())).join('')}`
}

async function loadOpenApiDocument(): Promise<OpenApiDocument> {
  const app = await createServerContractApp()
  const response = await app.handle(new Request('http://localhost/openapi.json'))
  if (!response.ok) {
    throw new Error(`Failed to load OpenAPI document: ${response.status}`)
  }
  return await response.json() as OpenApiDocument
}

function collectOperations(document: OpenApiDocument): CliOperationSpec[] {
  const operations: CliOperationSpec[] = []

  for (const [routePath, methods] of Object.entries(document.paths)) {
    for (const method of ['delete', 'get', 'patch', 'post', 'put'] as const) {
      const operation = methods[method]
      const cli = operation?.['x-cradle-cli']
      if (!operation || !cli || cli.hidden) {
        continue
      }
      const command = normalizeCommand(cli.command)
      if (command.length === 0) {
        throw new Error(`${method.toUpperCase()} ${routePath} has an empty CLI command`)
      }

      operations.push({
        arguments: collectArguments(operation),
        command,
        description: operation.summary,
        flags: collectFlags(operation),
        method,
        path: routePath,
      })
    }
  }

  return operations.sort((left, right) => left.command.join(' ').localeCompare(right.command.join(' ')))
}

async function writeGeneratedFiles(operations: CliOperationSpec[]): Promise<void> {
  await rm(generatedRoot, { force: true, recursive: true })
  await mkdir(generatedRoot, { recursive: true })

  const indexImports: Array<{ importName: string, relativePath: string }> = []

  await writeFile(path.join(generatedRoot, 'README.md'), `<!-- Once this directory changes, update this README.md -->

# Generated Commands

This directory is generated by \`pnpm gen:cli\`.

Do not edit generated command files manually. Add or change command placement
through server route \`x-cradle-cli\` metadata and rerun the generator.
`)

  for (const operation of operations) {
    const filePath = toGeneratedPath(operation.command)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, renderCommandModule(operation))
    indexImports.push({
      importName: createImportName(operation.command),
      relativePath: path.relative(generatedRoot, filePath).replace(TS_EXTENSION_RE, '').split(path.sep).join('/'),
    })
  }

  await writeFile(path.join(generatedRoot, 'index.generated.ts'), renderIndex(indexImports))
}

function escapeMarkdownCell(value: string): string {
  return value.replace(PIPE_RE, '\\|')
}

function renderSkillModulesBlock(operations: CliOperationSpec[]): string {
  const moduleNames = Array.from(new Set(operations.map(operation => operation.command[0])))
    .sort((left, right) => left.localeCompare(right))
  const lines = [
    generatedSkillStart,
    '## Command Modules',
    '',
    'It intentionally lists modules, not routes or leaf actions. Use `cradle man <module>` for full command manuals.',
    '',
    '| Module | Commands | Scope | Manual |',
    '| --- | ---: | --- | --- |',
  ]

  for (const moduleName of moduleNames) {
    const moduleOperations = operations.filter(operation => operation.command[0] === moduleName)
    const description = moduleDescriptions[moduleName] ?? 'Generated Cradle CLI module.'
    lines.push([
      `| \`${moduleName}\``,
      String(moduleOperations.length),
      escapeMarkdownCell(description),
      `\`cradle man ${moduleName}\` |`,
    ].join(' | '))
  }

  lines.push('', generatedSkillEnd)
  return lines.join('\n')
}

async function updateCradleCliSkill(operations: CliOperationSpec[]): Promise<void> {
  const content = await readFile(cradleCliSkillPath, 'utf8')
  const block = renderSkillModulesBlock(operations)
  const startIndex = content.indexOf(generatedSkillStart)
  const endIndex = content.indexOf(generatedSkillEnd)

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = content.slice(0, startIndex).trimEnd()
    const after = content.slice(endIndex + generatedSkillEnd.length).trimStart()
    await writeFile(cradleCliSkillPath, `${before}\n\n${block}\n\n${after}`)
    return
  }

  await writeFile(cradleCliSkillPath, `${content.trimEnd()}\n\n${block}\n`)
}

async function main(): Promise<void> {
  const document = await loadOpenApiDocument()
  const operations = collectOperations(document)

  if (operations.length === 0) {
    throw new Error('No x-cradle-cli operations found in OpenAPI document')
  }

  await writeGeneratedFiles(operations)
  await updateCradleCliSkill(operations)
  console.log(`Generated ${operations.length} CLI commands`)
  console.log(`Updated SKILL.md with ${Array.from(new Set(operations.map(op => op.command[0]))).length} modules`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
