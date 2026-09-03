import type { CradleOctokitInstance } from './client'

const REPOSITORY_ACCESS_TTL_MS = 60_000

export interface GitHubRepository {
  owner: string
  repo: string
}

interface RepositoryAccessCacheEntry {
  accessible: boolean
  expiresAt: number
}

const repositoryAccessCache = new Map<string, RepositoryAccessCacheEntry>()
const repositoryAccessInFlight = new Map<string, Promise<boolean | null>>()

/**
 * Resolve whether the connected GitHub App installation includes a repository.
 * A null result means GitHub could not answer, so callers must preserve the App
 * identity instead of guessing that it lacks access.
 */
export async function resolveGitHubAppRepositoryAccess(
  octokit: CradleOctokitInstance,
  identityKey: string,
  repository: GitHubRepository,
): Promise<boolean | null> {
  const cacheKey = `${identityKey}:${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`
  const cached = repositoryAccessCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessible
  }

  const active = repositoryAccessInFlight.get(cacheKey)
  if (active) {
    return active
  }

  const resolution = fetchGitHubAppRepositoryAccess(octokit, repository)
    .then((accessible) => {
      if (accessible !== null) {
        repositoryAccessCache.set(cacheKey, {
          accessible,
          expiresAt: Date.now() + REPOSITORY_ACCESS_TTL_MS,
        })
      }
      return accessible
    })
    .finally(() => {
      if (repositoryAccessInFlight.get(cacheKey) === resolution) {
        repositoryAccessInFlight.delete(cacheKey)
      }
    })
  repositoryAccessInFlight.set(cacheKey, resolution)
  return resolution
}

async function fetchGitHubAppRepositoryAccess(
  octokit: CradleOctokitInstance,
  repository: GitHubRepository,
): Promise<boolean | null> {
  try {
    const installations = await listInstallations(octokit)
    const ownerInstallations = installations.filter((installation) => {
      return installationAccountName(installation.account)?.toLowerCase() === repository.owner.toLowerCase()
        && installation.suspended_at === null
    })

    let accessible = ownerInstallations.some(installation => installation.repository_selection === 'all')
    if (!accessible) {
      for (const installation of ownerInstallations) {
        if (await installationIncludesRepository(octokit, installation.id, repository)) {
          accessible = true
          break
        }
      }
    }

    return accessible
  }
  catch {
    return null
  }
}

function installationAccountName(
  account: Awaited<ReturnType<
    CradleOctokitInstance['rest']['apps']['listInstallationsForAuthenticatedUser']
  >>['data']['installations'][number]['account'],
): string | null {
  if (!account) {
    return null
  }
  return 'login' in account ? account.login : account.slug
}

async function listInstallations(octokit: CradleOctokitInstance) {
  const installations: Awaited<ReturnType<
    CradleOctokitInstance['rest']['apps']['listInstallationsForAuthenticatedUser']
  >>['data']['installations'] = []

  for (let page = 1; ; page += 1) {
    const { data } = await octokit.rest.apps.listInstallationsForAuthenticatedUser({
      per_page: 100,
      page,
    })
    installations.push(...data.installations)
    if (data.installations.length < 100 || installations.length >= data.total_count) {
      return installations
    }
  }
}

async function installationIncludesRepository(
  octokit: CradleOctokitInstance,
  installationId: number,
  repository: GitHubRepository,
): Promise<boolean> {
  const fullName = `${repository.owner}/${repository.repo}`.toLowerCase()
  let visited = 0

  for (let page = 1; ; page += 1) {
    const { data } = await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
      installation_id: installationId,
      per_page: 100,
      page,
    })
    if (data.repositories.some(repo => repo.full_name.toLowerCase() === fullName)) {
      return true
    }
    visited += data.repositories.length
    if (data.repositories.length < 100 || visited >= data.total_count) {
      return false
    }
  }
}

export function clearGitHubRepositoryAccessCache(): void {
  repositoryAccessCache.clear()
  repositoryAccessInFlight.clear()
}
