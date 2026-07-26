import { execSync } from 'node:child_process'

import { resolveGitHubAppIdentity } from './github/auth-provider'

let cachedToken: string | null | undefined

/**
 * Prefer the connected GitHub App user. The process/CLI token remains an
 * explicit legacy-development fallback only when no App user is connected.
 */
export async function resolveGitHubToken(): Promise<string | null> {
  const appIdentity = await resolveGitHubAppIdentity()
  if (appIdentity) {
    return appIdentity.accessToken
  }
  return resolveLegacyGitHubToken()
}

export async function resolveLegacyGitHubToken(): Promise<string | null> {
  if (cachedToken !== undefined) {
    return cachedToken
  }

  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (envToken) {
    cachedToken = envToken
    return envToken
  }

  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (token && !token.includes(' ')) {
      cachedToken = token
      return token
    }
  }
  catch {
    // gh is optional; unauthenticated public GitHub reads can still work.
  }

  cachedToken = null
  return null
}

export function resetGitHubTokenCache(): void {
  cachedToken = undefined
}

export async function hasGitHubToken(): Promise<boolean> {
  return (await resolveGitHubToken()) !== null
}
