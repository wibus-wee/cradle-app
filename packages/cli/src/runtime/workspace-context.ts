import path from 'node:path'

import { z } from 'zod'

import type { CommandContext } from './types'

const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WorkspaceSummarySchema = z.object({
  id: z.string(),
  locator: z.object({ path: z.string() }).passthrough(),
  name: z.string(),
}).passthrough()

const WorkspaceListSchema = z.array(WorkspaceSummarySchema)

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>

export interface ResolveWorkspaceReferenceOptions {
  /**
   * Whether an omitted value should fall back through CRADLE_WORKSPACE_ID and
   * cwd auto-detection. Set to false for destructive/administrative commands
   * (e.g. `workspace delete`) where silently acting on "whatever the current
   * workspace is" would be a footgun — those still accept a name or id, they
   * just never guess one.
   */
  ambient?: boolean
}

function looksLikeWorkspaceId(value: string): boolean {
  return WORKSPACE_ID_RE.test(value)
}

async function fetchWorkspaces(context: CommandContext): Promise<WorkspaceSummary[]> {
  const result = await context.request({
    method: 'get',
    path: {},
    query: {},
    template: '/workspaces',
  })
  return WorkspaceListSchema.parse(result)
}

function describeCandidates(workspaces: WorkspaceSummary[]): string {
  return workspaces.map(workspace => `  ${workspace.name} (${workspace.id})`).join('\n')
}

function resolveByNameOrPrefix(workspaces: WorkspaceSummary[], candidate: string): string {
  const exactId = workspaces.find(workspace => workspace.id === candidate)
  if (exactId) {
    return exactId.id
  }

  const lower = candidate.toLowerCase()
  const exactName = workspaces.filter(workspace => workspace.name.toLowerCase() === lower)
  if (exactName.length === 1) {
    return exactName[0].id
  }
  if (exactName.length > 1) {
    throw new Error(`Multiple workspaces are named "${candidate}":\n${describeCandidates(exactName)}\nPass the workspace id instead.`)
  }

  const prefixMatches = workspaces.filter(workspace => workspace.name.toLowerCase().startsWith(lower))
  if (prefixMatches.length === 1) {
    return prefixMatches[0].id
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Multiple workspaces match "${candidate}":\n${describeCandidates(prefixMatches)}\nPass a more specific name or the workspace id.`)
  }

  throw new Error(`No workspace matches "${candidate}". Run \`cradle workspace list\` to see available workspaces.`)
}

function isPathAncestorOrSelf(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  if (normalizedRoot === normalizedTarget) {
    return true
  }
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`
  return normalizedTarget.startsWith(rootWithSeparator)
}

function detectFromCwd(workspaces: WorkspaceSummary[]): string | undefined {
  const cwd = process.cwd()
  const matches = workspaces
    .filter(workspace => isPathAncestorOrSelf(workspace.locator.path, cwd))
    .sort((left, right) => right.locator.path.length - left.locator.path.length)
  return matches[0]?.id
}

/**
 * Resolves a workspace name-or-id into a workspace id, the way `gh -R` or
 * `git` resolve their target without requiring a raw database id.
 *
 * Precedence: explicit CLI value > CRADLE_WORKSPACE_ID env var (when ambient)
 * > the workspace whose registered path is an ancestor of `cwd` (when
 * ambient). No state is persisted — this always reflects the current
 * environment and working directory, like `git` resolving the current repo.
 */
export async function resolveWorkspaceReference(
  context: CommandContext,
  explicitValue: string | undefined,
  options: ResolveWorkspaceReferenceOptions = {},
): Promise<string | undefined> {
  const ambient = options.ambient !== false
  const candidate = explicitValue?.trim() || (ambient ? process.env.CRADLE_WORKSPACE_ID?.trim() : undefined) || undefined

  if (candidate && looksLikeWorkspaceId(candidate)) {
    return candidate
  }

  if (candidate) {
    const workspaces = await fetchWorkspaces(context)
    return resolveByNameOrPrefix(workspaces, candidate)
  }

  if (!ambient) {
    return undefined
  }

  const workspaces = await fetchWorkspaces(context)
  return detectFromCwd(workspaces)
}
