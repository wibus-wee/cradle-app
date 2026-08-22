import { resolve } from 'node:path'

import simpleGit from 'simple-git'

import type { WorkspaceGitIdentity } from './workspace-locator'

const RE_SCP_LIKE = /^git@([^:/]+):/
const RE_PROTOCOL_PREFIX = /^(?:https?|ssh|git|git\+ssh):\/\//
const RE_USER_PREFIX = /^[\w.-]+@/

/**
 * Canonical cross-machine identity for a git repository.
 *
 * Collapses remote syntax variants (`git@github.com:wibus/cradle-app.git`,
 * `https://GitHub.com/wibus/cradle-app`, `ssh://git@github.com/wibus/cradle-app`)
 * into one comparable key so the same repository can be recognized across
 * workspaces and machines. Returns `null` when no usable host/repo path remains.
 */
export function normalizeRepoKey(originUrl: string | null | undefined): string | null {
  if (!originUrl) {
    return null
  }
  const trimmed = originUrl.trim()
  if (!trimmed) {
    return null
  }
  const withoutProtocol = trimmed.replace(RE_PROTOCOL_PREFIX, '')
  const withoutScp = withoutProtocol.replace(RE_SCP_LIKE, '$1/')
  const withoutUser = withoutScp.replace(RE_USER_PREFIX, '')
  const stripped = withoutUser.replace(/\/+$/, '').replace(/\.git$/i, '')
  return stripped.toLowerCase() || null
}

/**
 * Best-effort git identity probe for a local directory.
 *
 * Never throws: directories that are not git repositories (or where git is
 * unavailable) yield an empty identity so workspace creation keeps working.
 */
export async function probeLocalGitIdentity(path: string): Promise<WorkspaceGitIdentity> {
  const absolutePath = resolve(path)
  try {
    const git = simpleGit({ baseDir: absolutePath })
    const [repoRoot, originUrl, branch, headSha] = await Promise.all([
      git.revparse('--show-toplevel').catch(() => null),
      git.remote(['get-url', 'origin']).catch(() => null),
      git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null),
      git.revparse('HEAD').catch(() => null),
    ])
    return {
      ...(repoRoot ? { repoRoot } : {}),
      ...(originUrl?.trim() ? { originUrl: originUrl.trim() } : {}),
      ...(branch && branch !== 'HEAD' ? { branch } : {}),
      ...(headSha ? { headSha } : {}),
    }
  }
  catch {
    return {}
  }
}
