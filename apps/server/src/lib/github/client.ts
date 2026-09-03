import { throttling } from '@octokit/plugin-throttling'
import { Octokit, RequestError } from 'octokit'

import { resolveLegacyGitHubToken } from '../github-api-token'
import { outboundFetch } from '../outbound-network'
import { resolveGitHubAppIdentity } from './auth-provider'
import type { GitHubRepository } from './repository-access'
import {
  clearGitHubRepositoryAccessCache,
  resolveGitHubAppRepositoryAccess,
} from './repository-access'

const GITHUB_REQUEST_TIMEOUT_MS = 20_000
/** Below this remaining budget, non-force GETs must not hit the network. */
export const GITHUB_RATE_LIMIT_SOFT_FLOOR = 500

const CradleOctokit = Octokit.plugin(throttling)

export type CradleOctokitInstance = InstanceType<typeof CradleOctokit>

let rateLimitRemaining = 5000
let rateLimitReset = 0
let cachedOctokit: CradleOctokitInstance | null = null
let cachedOctokitCacheKey: string | null | undefined

interface GitHubCredential {
  token: string | null
  cacheKey: string | null
  source: 'github-app' | 'legacy'
}

export { RequestError }

export class GitHubAuthRequiredError extends Error {
  readonly status = 401

  constructor(message = 'GitHub authentication required. Connect GitHub App, set GH_TOKEN / GITHUB_TOKEN, or run `gh auth login`.') {
    super(message)
    this.name = 'GitHubAuthRequiredError'
  }
}

export function recordGitHubRateLimit(
  headers: Headers | Record<string, string | number | undefined> | undefined,
): void {
  if (!headers) {
    return
  }
  const remainingRaw = headers instanceof Headers
    ? headers.get('x-ratelimit-remaining') ?? headers.get('X-RateLimit-Remaining')
    : headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining']
  const resetRaw = headers instanceof Headers
    ? headers.get('x-ratelimit-reset') ?? headers.get('X-RateLimit-Reset')
    : headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset']
  if (remainingRaw !== undefined && remainingRaw !== null && `${remainingRaw}`.length > 0) {
    const parsed = Number.parseInt(String(remainingRaw), 10)
    if (Number.isFinite(parsed)) {
      rateLimitRemaining = parsed
    }
  }
  if (resetRaw !== undefined && resetRaw !== null && `${resetRaw}`.length > 0) {
    const parsed = Number.parseInt(String(resetRaw), 10)
    if (Number.isFinite(parsed)) {
      rateLimitReset = parsed
    }
  }
}

export function getGitHubRateLimitRemaining(): number {
  return rateLimitRemaining
}

export function isGitHubRateLimited(): boolean {
  if (rateLimitRemaining > GITHUB_RATE_LIMIT_SOFT_FLOOR) {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  return now < rateLimitReset
}

/** True when we should avoid discretionary network GETs and serve stale cache. */
export function shouldAvoidGitHubNetwork(): boolean {
  return rateLimitRemaining <= GITHUB_RATE_LIMIT_SOFT_FLOOR
}

export function resetGitHubClientState(): void {
  rateLimitRemaining = 5000
  rateLimitReset = 0
  cachedOctokit = null
  cachedOctokitCacheKey = undefined
  clearGitHubRepositoryAccessCache()
}

function createOctokitFetch(): typeof fetch {
  return async (input, init) => {
    const response = await outboundFetch(input, init)
    if (response.status === 204 || response.status === 304) {
      return response
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('json')) {
      return response
    }
    // Test mocks and some edge proxies omit / mis-label Content-Type; Octokit
    // then returns a raw string / fails to unwrap GraphQL `data`. Normalize.
    const text = await response.text()
    const headers = new Headers(response.headers)
    headers.set('content-type', 'application/json; charset=utf-8')
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

function getOctokitForCredential(credential: GitHubCredential): CradleOctokitInstance {
  if (cachedOctokit && cachedOctokitCacheKey === credential.cacheKey) {
    return cachedOctokit
  }

  cachedOctokitCacheKey = credential.cacheKey
  cachedOctokit = new CradleOctokit({
    auth: credential.token ?? undefined,
    request: {
      timeout: GITHUB_REQUEST_TIMEOUT_MS,
      fetch: createOctokitFetch(),
    },
    throttle: {
      onRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 2,
      onSecondaryRateLimit: (_retryAfter, _options, _octokit, retryCount) => retryCount < 2,
    },
  })
  return cachedOctokit
}

async function resolveGitHubCredential(repository?: GitHubRepository): Promise<GitHubCredential> {
  const appIdentity = await resolveGitHubAppIdentity()
  if (appIdentity) {
    const appCredential: GitHubCredential = {
      token: appIdentity.accessToken,
      cacheKey: appIdentity.cacheKey,
      source: 'github-app',
    }
    if (!repository) {
      return appCredential
    }

    const legacyToken = await resolveLegacyGitHubToken()
    if (!legacyToken) {
      return appCredential
    }

    const appOctokit = getOctokitForCredential(appCredential)
    const accessible = await resolveGitHubAppRepositoryAccess(
      appOctokit,
      appIdentity.cacheKey,
      repository,
    )
    if (accessible !== false) {
      return appCredential
    }

    return {
      token: legacyToken,
      cacheKey: 'legacy:process',
      source: 'legacy',
    }
  }

  const legacyToken = await resolveLegacyGitHubToken()
  if (legacyToken) {
    return {
      token: legacyToken,
      cacheKey: 'legacy:process',
      source: 'legacy',
    }
  }

  return {
    token: null,
    cacheKey: null,
    source: 'legacy',
  }
}

export async function getGitHubCacheScope(repository?: GitHubRepository): Promise<string | null> {
  const credential = await resolveGitHubCredential(repository)
  return credential.source === 'github-app' ? credential.cacheKey : null
}

export async function resolveGitHubRepositoryToken(
  repository: GitHubRepository,
): Promise<string | null> {
  return (await resolveGitHubCredential(repository)).token
}

export async function getOctokit(options?: {
  requireToken?: boolean
  repository?: GitHubRepository
}): Promise<CradleOctokitInstance> {
  const credential = await resolveGitHubCredential(options?.repository)
  if (options?.requireToken && !credential.token) {
    throw new GitHubAuthRequiredError()
  }
  return getOctokitForCredential(credential)
}
