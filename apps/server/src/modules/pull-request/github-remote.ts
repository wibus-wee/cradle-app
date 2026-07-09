export function parseGitHubOwnerRepo(remoteUrl: string): { owner: string, repo: string } | null {
  const trimmed = remoteUrl.trim()
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i)
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/i, '') }
  }

  try {
    const url = new URL(trimmed.replace(/^git\+/, ''))
    if (!/github\.com$/i.test(url.hostname)) {
      return null
    }
    const parts = url.pathname.replace(/^\//, '').replace(/\.git$/i, '').split('/')
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return null
    }
    return { owner: parts[0], repo: parts[1] }
  }
  catch {
    return null
  }
}
