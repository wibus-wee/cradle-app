import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GH_TIMEOUT_MS = 5000
const PROJECTION_TTL_MS = 30_000

export interface LocalGitHubCredentialProjection {
  /** True when the local gh CLI (or GH_TOKEN/GITHUB_TOKEN env) can authenticate. */
  available: boolean
  /** gh CLI viewer login when it can be resolved; null for env tokens or probe failures. */
  login: string | null
  /** Where the local credential comes from. */
  source: 'env' | 'gh-cli' | null
}

interface CacheEntry {
  projection: LocalGitHubCredentialProjection
  expiresAt: number
}

let cache: CacheEntry | null = null
let inFlight: Promise<LocalGitHubCredentialProjection> | null = null
let probeForTests: (() => Promise<LocalGitHubCredentialProjection>) | null = null

/**
 * Safe projection of the ambient local GitHub credential. The probe shells out
 * to the gh CLI and never surfaces the token itself; only availability, the
 * owning login, and the credential source are exposed.
 */
export async function resolveLocalGitHubCredential(): Promise<LocalGitHubCredentialProjection> {
  if (probeForTests) {
    return probeForTests()
  }
  if (cache && cache.expiresAt > Date.now()) {
    return cache.projection
  }
  if (inFlight) {
    return inFlight
  }
  const resolution = probeLocalCredential()
    .then((projection) => {
      cache = { projection, expiresAt: Date.now() + PROJECTION_TTL_MS }
      return projection
    })
    .finally(() => {
      if (inFlight === resolution) {
        inFlight = null
      }
    })
  inFlight = resolution
  return resolution
}

export function setLocalGitHubCredentialProbeForTests(probe: (() => Promise<LocalGitHubCredentialProjection>) | null): void {
  probeForTests = probe
  cache = null
  inFlight = null
}

export function resetLocalGitHubCredentialCache(): void {
  cache = null
  inFlight = null
}

async function probeLocalCredential(): Promise<LocalGitHubCredentialProjection> {
  if (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN) {
    return { available: true, login: null, source: 'env' }
  }

  const token = await runGh(['auth', 'token'])
  if (!token || token.includes(' ')) {
    return { available: false, login: null, source: null }
  }

  const login = await resolveGhLogin()
  return { available: true, login, source: 'gh-cli' }
}

async function resolveGhLogin(): Promise<string | null> {
  // `gh api user` verifies the token against GitHub and returns the owning
  // login in one call. A network failure must not downgrade availability:
  // the token exists locally regardless of whether GitHub is reachable now.
  const output = await runGh(['api', 'user', '--jq', '.login'])
  return output && !output.includes(' ') ? output : null
}

async function runGh(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      encoding: 'utf-8',
      timeout: GH_TIMEOUT_MS,
    })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  catch {
    return null
  }
}
