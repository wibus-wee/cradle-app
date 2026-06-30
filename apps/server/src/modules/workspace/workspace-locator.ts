import { z } from 'zod'

export const LOCAL_WORKSPACE_HOST_ID = 'local' as const

const nonBlankString = z.string().trim().min(1)

export const workspaceLocatorSchema = z.object({
  hostId: nonBlankString,
  path: nonBlankString,
  kind: z.enum(['project', 'managed-worktree']).optional(),
  sourceWorkspaceId: nonBlankString.nullable().optional(),
})

export const workspaceGitIdentitySchema = z.object({
  originUrl: nonBlankString.nullable().optional(),
  repoRoot: nonBlankString.nullable().optional(),
  headSha: nonBlankString.nullable().optional(),
  branch: nonBlankString.nullable().optional(),
})

export type WorkspaceLocator = z.infer<typeof workspaceLocatorSchema>
export type WorkspaceGitIdentity = z.infer<typeof workspaceGitIdentitySchema>

export function normalizeWorkspaceLocator(input: WorkspaceLocator): WorkspaceLocator {
  const locator = workspaceLocatorSchema.parse(input)
  return {
    hostId: locator.hostId,
    path: locator.path,
    ...(locator.kind ? { kind: locator.kind } : {}),
    ...(locator.sourceWorkspaceId !== undefined ? { sourceWorkspaceId: locator.sourceWorkspaceId } : {}),
  }
}

export function normalizeWorkspaceGitIdentity(input: WorkspaceGitIdentity = {}): WorkspaceGitIdentity {
  const identity = workspaceGitIdentitySchema.parse(input)
  return {
    ...(identity.originUrl !== undefined ? { originUrl: identity.originUrl } : {}),
    ...(identity.repoRoot !== undefined ? { repoRoot: identity.repoRoot } : {}),
    ...(identity.headSha !== undefined ? { headSha: identity.headSha } : {}),
    ...(identity.branch !== undefined ? { branch: identity.branch } : {}),
  }
}

export function serializeWorkspaceLocator(input: WorkspaceLocator): string {
  return JSON.stringify(normalizeWorkspaceLocator(input))
}

export function serializeWorkspaceGitIdentity(input: WorkspaceGitIdentity = {}): string {
  return JSON.stringify(normalizeWorkspaceGitIdentity(input))
}

export function readWorkspaceLocatorJson(json: string): WorkspaceLocator {
  return normalizeWorkspaceLocator(workspaceLocatorSchema.parse(JSON.parse(json)))
}

export function readWorkspaceGitIdentityJson(json: string): WorkspaceGitIdentity {
  return normalizeWorkspaceGitIdentity(workspaceGitIdentitySchema.parse(JSON.parse(json || '{}')))
}

export function isLocalWorkspaceLocator(locator: WorkspaceLocator): boolean {
  return locator.hostId === LOCAL_WORKSPACE_HOST_ID
}

export function localWorkspaceLocator(path: string): WorkspaceLocator {
  return { hostId: LOCAL_WORKSPACE_HOST_ID, path }
}
