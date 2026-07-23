export interface GitHubPullRequestReference {
  owner: string
  repo: string
  number: number
}

interface GitHubPullRequestIdentity {
  owner: string
  repo: string
  number: string | number
}

const OWNER_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?'
const REPO_PATTERN = '[\\w.-]+'
const SHORT_REFERENCE = new RegExp(`^(${OWNER_PATTERN})\/(${REPO_PATTERN})#([1-9]\\d*)$`, 'i')
const PATH_REFERENCE = new RegExp(`^(${OWNER_PATTERN})\/(${REPO_PATTERN})\/pull\/([1-9]\\d*)\/?$`, 'i')
const URL_PATH_REFERENCE = new RegExp(`^(${OWNER_PATTERN})\/(${REPO_PATTERN})\/pull\/([1-9]\\d*)(?:\/.*)?$`, 'i')

function matchReference(value: string): GitHubPullRequestReference | null {
  const match = SHORT_REFERENCE.exec(value) ?? PATH_REFERENCE.exec(value)
  if (!match) {
    return null
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]),
  }
}

export function parseGitHubPullRequestReference(value: string): GitHubPullRequestReference | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const direct = matchReference(trimmed)
  if (direct) {
    return direct
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      return null
    }
    const match = URL_PATH_REFERENCE.exec(url.pathname.replace(/^\//, ''))
    if (!match) {
      return null
    }
    return {
      owner: match[1]!,
      repo: match[2]!,
      number: Number(match[3]),
    }
  }
  catch {
    return null
  }
}

export function githubPullRequestReferenceKey(reference: GitHubPullRequestIdentity): string {
  return `${reference.owner.toLowerCase()}/${reference.repo.toLowerCase()}#${reference.number}`
}
