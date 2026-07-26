export interface GitHubAuthIdentity {
  accessToken: string
  cacheKey: string
  source: 'github-app'
}

export type GitHubAuthProvider = () => Promise<GitHubAuthIdentity | null>

let provider: GitHubAuthProvider | null = null

export function setGitHubAuthProvider(nextProvider: GitHubAuthProvider | null): void {
  provider = nextProvider
}

export async function resolveGitHubAppIdentity(): Promise<GitHubAuthIdentity | null> {
  return provider ? provider() : null
}

export function resetGitHubAuthProviderForTests(): void {
  provider = null
}
