export interface ParsedGitHubPullRequestLink {
  owner: string
  repo: string
  number: number
}

/**
 * Parse a GitHub pull request URL into the identity used by the Pull Request
 * detail API and Browser Panel tab.
 *
 * GitHub keeps the repository identity in the first two path segments, so
 * links to a PR's files, commits, or checks can all reuse the same detail tab.
 */
export function parseGitHubPullRequestFromHref(
  href: string | undefined,
): ParsedGitHubPullRequestLink | null {
  if (!href) {
    return null
  }

  let url: URL
  try {
    url = new URL(href)
  }
 catch {
    return null
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
  ) {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 4 || segments[2] !== 'pull') {
    return null
  }

  const number = Number(segments[3])
  if (!Number.isSafeInteger(number) || number <= 0 || !/^\d+$/.test(segments[3])) {
    return null
  }

  const [owner, repo] = segments
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return null
  }

  return { owner, repo, number }
}
