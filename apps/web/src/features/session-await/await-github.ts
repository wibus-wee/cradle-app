interface GitRemote {
  name: string
  fetchUrl: string | null
  pushUrl: string | null
}

export interface GitHubRepository {
  owner: string
  repo: string
  fullName: string
  remoteName: string
  remoteUrl: string
}

export type GitHubAwaitTarget
  = | { kind: 'pull-request', filter: { pr: number }, label: string }
    | { kind: 'commit-ref', filter: { sha: string }, label: string }
    | { kind: 'check-run', filter: { runs_id: number }, label: string }

export function describeGitHubAwaitTargetInputIssue(input: string, sourceKind: 'github-ci' | 'github-review'): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const parsed = parseGitHubAwaitTargetInput(trimmed)
  if (sourceKind === 'github-review' && parsed && parsed.kind !== 'pull-request') {
    return 'Review awaits require a pull request number.'
  }
  if (parsed) {
    return null
  }
  if (/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/i.test(trimmed)) {
    return 'GitHub Actions workflow run URLs are not supported. Paste a check run URL or use the PR number.'
  }
  return sourceKind === 'github-review'
    ? 'Enter a pull request number.'
    : 'Enter a pull request number, commit ref, or GitHub check run URL.'
}

function normalizeRepositoryPath(pathname: string): string | null {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '')
  const segments = clean.split('/').filter(Boolean)
  if (segments.length < 2) {
    return null
  }

  const [owner, repo] = segments
  if (!/^[A-Z0-9-]+$/i.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return null
  }

  return `${owner}/${repo}`
}

export function parseGitHubRepositoryFromUrl(remoteUrl: string | null | undefined): Omit<GitHubRepository, 'remoteName' | 'remoteUrl'> | null {
  const input = remoteUrl?.trim()
  if (!input) {
    return null
  }

  const scpMatch = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(input)
  if (scpMatch) {
    const fullName = normalizeRepositoryPath(scpMatch[1])
    if (!fullName) {
      return null
    }
    const [owner, repo] = fullName.split('/')
    return { owner, repo, fullName }
  }

  try {
    const parsed = new URL(input)
    const host = parsed.hostname.toLowerCase()
    if (host !== 'github.com' && host !== 'www.github.com') {
      return null
    }

    const fullName = normalizeRepositoryPath(parsed.pathname)
    if (!fullName) {
      return null
    }

    const [owner, repo] = fullName.split('/')
    return { owner, repo, fullName }
  }
  catch {
    return null
  }
}

export function parseGitHubRepositoryInput(input: string): Omit<GitHubRepository, 'remoteName' | 'remoteUrl'> | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const fullName = normalizeRepositoryPath(trimmed)
  if (fullName) {
    const [owner, repo] = fullName.split('/')
    return { owner, repo, fullName }
  }

  return parseGitHubRepositoryFromUrl(trimmed)
}

export function selectGitHubRepository(remotes: GitRemote[] | undefined): GitHubRepository | null {
  if (!remotes?.length) {
    return null
  }

  const sorted = [...remotes].sort((a, b) => {
    if (a.name === 'origin') {
      return -1
    }
    if (b.name === 'origin') {
      return 1
    }
    return a.name.localeCompare(b.name)
  })

  for (const remote of sorted) {
    const remoteUrl = remote.fetchUrl ?? remote.pushUrl
    const parsed = parseGitHubRepositoryFromUrl(remoteUrl)
    if (parsed && remoteUrl) {
      return {
        ...parsed,
        remoteName: remote.name,
        remoteUrl,
      }
    }
  }

  return null
}

export function parseGitHubAwaitTargetInput(input: string): GitHubAwaitTarget | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const checkRunMatch = /(?:^|[/:])(?:check-)?runs[/:](\d+)(?:$|[/?#])/.exec(trimmed)
  if (checkRunMatch && !/\/actions\/runs\/\d+(?:$|[/?#])/.test(trimmed)) {
    const checkRunId = Number.parseInt(checkRunMatch[1], 10)
    return { kind: 'check-run', filter: { runs_id: checkRunId }, label: `/runs/${checkRunId}` }
  }

  if (/^\d+$/.test(trimmed)) {
    const prNumber = Number.parseInt(trimmed, 10)
    return prNumber > 0
      ? { kind: 'pull-request', filter: { pr: prNumber }, label: `#${prNumber}` }
      : null
  }

  if (/^[\w./-]+$/.test(trimmed)) {
    return { kind: 'commit-ref', filter: { sha: trimmed }, label: `@${trimmed}` }
  }

  return null
}

export function derivePullRequestNumberFromStatus(status: {
  branch?: string | null
  tracking?: string | null
} | null | undefined): number | null {
  const candidates = [status?.tracking, status?.branch].filter((value): value is string => !!value)

  for (const candidate of candidates) {
    const match = /(?:^|\/)pull\/(\d+)\/(?:head|merge)$/i.exec(candidate)
    if (match) {
      return Number.parseInt(match[1], 10)
    }
  }

  return null
}
