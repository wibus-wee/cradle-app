const RE_SCP_LIKE = /^git@([^:/]+):/
const RE_PROTOCOL_PREFIX = /^(?:https?|ssh|git|git\+ssh):\/\//
const RE_USER_PREFIX = /^[\w.-]+@/

/**
 * Canonical cross-machine identity for a git repository.
 *
 * Collapses remote syntax variants (`git@github.com:wibus/cradle-app.git`,
 * `https://GitHub.com/wibus/cradle-app`, `ssh://git@github.com/wibus/cradle-app`)
 * into one comparable key so the same repository can be recognized across
 * workspaces and machines. Must stay in sync with the server-side
 * `normalizeRepoKey` (apps/server/src/modules/workspace/repo-identity.ts).
 * Returns `null` when no usable host/repo path remains.
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
 * Stable grouping key for a git-backed workspace replica. Workspaces sharing a
 * key are replicas of the same repository across machines; workspaces without
 * any git identity can never be grouped (`null`).
 */
export function workspaceRepoKey(input: {
  originUrl?: string | null
  repoRoot?: string | null
}): string | null {
  const origin = normalizeRepoKey(input.originUrl)
  if (origin) {
    return `origin:${origin}`
  }
  if (input.repoRoot?.trim()) {
    return `repo:${input.repoRoot.trim().toLowerCase()}`
  }
  return null
}

/** Structured parts of an `origin:` repo key (`host/owner/repo[/subgroup...]`). */
export interface RepoKeyParts {
  host: string
  owner: string
  repo: string
}

/**
 * Split a repo key from `workspaceRepoKey` into host/owner/repo parts.
 * Only `origin:` keys carry a host/owner structure; `repo:` fallback keys
 * (git repositories without a remote) return `null`.
 */
export function parseRepoKey(key: string | null | undefined): RepoKeyParts | null {
  if (!key || !key.startsWith('origin:')) {
    return null
  }
  const segments = key.slice('origin:'.length).split('/').filter(Boolean)
  const [host, owner, ...repoSegments] = segments
  if (!host || !owner || repoSegments.length === 0) {
    return null
  }
  return { host, owner, repo: repoSegments.join('/') }
}

/**
 * Avatar image URL for the repository owner, when the host exposes one
 * (GitHub only). Other hosts fall back to the owner's initial.
 */
export function repoOwnerAvatarUrl(parts: RepoKeyParts): string | null {
  return parts.host === 'github.com'
    ? `https://github.com/${parts.owner}.png?size=32`
    : null
}

/** Short human label for a repo key: the last path segment of the repository. */
export function repoDisplayNameFromKey(key: string): string {
  const segment = key.split(':').pop() ?? key
  return segment.split('/').pop() ?? segment
}
