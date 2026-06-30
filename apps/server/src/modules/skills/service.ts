import { AppError } from '../../errors/app-error'
import * as Workspace from '../workspace/service'
import type { DiscoveredSkill, ParsedSkillSource } from './skill-source.store'
import { cleanupFetchSession, fetchSkillsFromSource, getFetchSession } from './skill-source.store'
import type {
  SkillDocument,
  SkillInventoryEntry,
} from './skills.store'
import {
  createSkillDocument,
  deleteSkillDocument,
  exportSkillPackage,
  importMultipleSkillPackages,
  importSkillPackage,
  listSkillInventory,
  readSkillDocument,
  updateSkillDocument,
} from './skills.store'
import type { SkillScope } from './skills-paths'

export interface SkillExportOwnerBoundary {
  classification: 'non-cradle-owned'
  owner: 'user-selected-export-directory'
  consentRequired: true
  consentConfirmed: true
  destinationDir: string
  targetPath: string
}

function resolveWorkspacePath(workspaceId?: string | null): string | undefined {
  if (!workspaceId) {
    return undefined
  }
  const workspacePath = Workspace.getLocalWorkspacePath(workspaceId)
  if (!workspacePath) {
    throw new AppError({
      code: 'skills_local_workspace_required',
      status: 409,
      message: 'Workspace skills require a local workspace',
      details: { workspaceId },
    })
  }
  return workspacePath
}

function mapError(error: unknown): Error {
  if (error instanceof AppError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)

  if (message.endsWith('skills are read-only')) {
    return new AppError({ code: 'skills_scope_read_only', status: 400, message })
  }

  if (message.startsWith('Skill not found:')) {
    return new AppError({ code: 'skill_not_found', status: 404, message: 'Skill not found', details: { source: message } })
  }

  if (message.startsWith('Skill already exists:') || message.includes('already exists') || message.startsWith('Export destination already exists:')) {
    return new AppError({ code: 'skills_conflict', status: 409, message })
  }

  if (message.startsWith('Workspace not found:')) {
    return new AppError({ code: 'skills_workspace_not_found', status: 404, message: 'Workspace not found' })
  }

  if (
    message.startsWith('Invalid ID:')
    || message === 'workspacePath is required for repository skills'
    || message === 'workspacePath is required for workspace skills'
    || message === 'agentId is required for agent skills'
    || message === 'Skill name is required'
  ) {
    return new AppError({ code: 'invalid_skills_input', status: 400, message })
  }

  if (
    message.startsWith('Cannot parse skill source:')
    || message.startsWith('Local path not found:')
    || message.startsWith('Failed to clone repository:')
    || message.startsWith('Authentication failed for ')
    || message.startsWith('Path not found in repository:')
    || message.includes('SKILL.md')
    || message.startsWith('Unsafe subpath:')
  ) {
    return new AppError({ code: 'invalid_skills_source', status: 400, message })
  }

  return error instanceof Error ? error : new Error(message)
}

async function wrapAsync<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (error) {
    throw mapError(error)
  }
}

export function list(params?: { workspaceId?: string | null, agentId?: string | null }): Promise<SkillInventoryEntry[]> {
  return wrapAsync(() => Promise.resolve(listSkillInventory({
    workspacePath: resolveWorkspacePath(params?.workspaceId),
    agentId: params?.agentId ?? undefined,
  })))
}

export function get(params: { scope: SkillScope, name: string, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument> {
  return wrapAsync(() => readSkillDocument({
    scope: params.scope,
    name: params.name,
    workspacePath: resolveWorkspacePath(params.workspaceId),
    agentId: params.agentId ?? undefined,
  }))
}

export function create(params: { scope: SkillScope, name: string, description: string, body: string, workspaceId?: string | null, agentId?: string | null, frontmatter?: Record<string, unknown> }): Promise<SkillDocument> {
  return wrapAsync(() => createSkillDocument(params.scope, {
    name: params.name,
    description: params.description,
    body: params.body,
    frontmatter: params.frontmatter,
    workspacePath: resolveWorkspacePath(params.workspaceId),
    agentId: params.agentId ?? undefined,
  }))
}

export function update(params: { scope: SkillScope, name: string, workspaceId?: string | null, agentId?: string | null, document: { name: string, description: string, body: string, frontmatter?: Record<string, unknown> } }): Promise<SkillDocument> {
  return wrapAsync(() => updateSkillDocument({
    scope: params.scope,
    name: params.name,
    document: params.document,
    workspacePath: resolveWorkspacePath(params.workspaceId),
    agentId: params.agentId ?? undefined,
  }))
}

export function remove(params: { scope: SkillScope, name: string, workspaceId?: string | null, agentId?: string | null }): Promise<void> {
  return wrapAsync(() => deleteSkillDocument({
    scope: params.scope,
    name: params.name,
    workspacePath: resolveWorkspacePath(params.workspaceId),
    agentId: params.agentId ?? undefined,
  }))
}

export function importSkill(params: { scope: SkillScope, sourceDir: string, overwrite?: boolean, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument> {
  return wrapAsync(() => importSkillPackage(params.scope, {
    sourceDir: params.sourceDir,
    overwrite: params.overwrite,
    workspacePath: resolveWorkspacePath(params.workspaceId),
    agentId: params.agentId ?? undefined,
  }))
}

export function exportSkill(params: {
  scope: SkillScope
  name: string
  destinationDir: string
  confirmedNonCradleOwnedWrite: boolean
  overwrite?: boolean
  workspaceId?: string | null
  agentId?: string | null
}): Promise<{ destinationDir: string, ownerBoundary: SkillExportOwnerBoundary }> {
  return wrapAsync(async () => {
    if (!params.confirmedNonCradleOwnedWrite) {
      throw new AppError({
        code: 'non_cradle_owned_write_confirmation_required',
        status: 400,
        message: 'Skill export requires explicit non-Cradle-owned write confirmation',
        details: {
          ownerBoundary: {
            classification: 'non-cradle-owned',
            owner: 'user-selected-export-directory',
            consentRequired: true,
            consentConfirmed: false,
            destinationDir: params.destinationDir,
          },
        },
      })
    }

    const targetPath = await exportSkillPackage({
      scope: params.scope,
      name: params.name,
      destinationDir: params.destinationDir,
      overwrite: params.overwrite,
      workspacePath: resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    })

    return {
      destinationDir: targetPath,
      ownerBoundary: {
        classification: 'non-cradle-owned',
        owner: 'user-selected-export-directory',
        consentRequired: true,
        consentConfirmed: true,
        destinationDir: params.destinationDir,
        targetPath,
      },
    }
  })
}

export async function fetchSource(source: string): Promise<{ sessionId: string, source: ParsedSkillSource, skills: DiscoveredSkill[] }> {
  return wrapAsync(async () => {
    const result = await fetchSkillsFromSource(source)
    return { sessionId: result.sessionId, source: result.source, skills: result.skills }
  })
}

export async function importFromFetch(params: { sessionId: string, selectedDirs: string[], scope: SkillScope, overwrite?: boolean, workspaceId?: string | null, agentId?: string | null }): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> {
  return wrapAsync(async () => {
    const session = getFetchSession(params.sessionId)
    if (!session) {
      throw new AppError({
        code: 'skills_fetch_session_not_found',
        status: 404,
        message: 'Fetch session not found',
        details: { sessionId: params.sessionId },
      })
    }

    const allowedDirs = new Set(session.skills.map(skill => skill.skillDir))
    for (const dir of params.selectedDirs) {
      if (!allowedDirs.has(dir)) {
        throw new AppError({
          code: 'invalid_skills_input',
          status: 400,
          message: 'selectedDirs must come from the fetch session results',
          details: { dir },
        })
      }
    }

    try {
      return await importMultipleSkillPackages(params.scope, {
        sourceDirs: params.selectedDirs,
        overwrite: params.overwrite,
        workspacePath: resolveWorkspacePath(params.workspaceId),
        agentId: params.agentId ?? undefined,
      })
    }
    finally {
      await cleanupFetchSession(params.sessionId)
    }
  })
}

export function cancelFetch(sessionId: string): Promise<void> {
  return wrapAsync(() => cleanupFetchSession(sessionId))
}
