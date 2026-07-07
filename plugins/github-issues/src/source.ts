import type {
  ExternalIssueRecord,
  ExternalIssueSource,
  ExternalIssueSourceReadContext,
  ExternalIssueSourceSnapshot,
  ExternalIssueWarning,
} from '@cradle/plugin-sdk/server'

const DEFAULT_API_BASE_URL = 'https://api.github.com'
const DEFAULT_MAX_PER_REPO = 100
const PAGE_SIZE = 100

interface GitHubIssueLabel {
  name?: string | null
}

interface GitHubIssueUser {
  login?: string | null
}

interface GitHubIssueMilestone {
  title?: string | null
}

interface GitHubIssueRecord {
  node_id?: string
  id?: number
  html_url?: string
  number?: number
  title?: string
  body?: string | null
  state?: string
  labels?: Array<string | GitHubIssueLabel>
  assignees?: GitHubIssueUser[]
  milestone?: GitHubIssueMilestone | null
  created_at?: string
  updated_at?: string
  closed_at?: string | null
  pull_request?: unknown
}

interface GitHubIssuesSourceConfig {
  apiBaseUrl: string
  token: string | null
  maxPerRepo: number
}

export function createGitHubIssuesSource(): ExternalIssueSource {
  return {
    id: 'github-issues',
    label: 'GitHub Issues',
    description: 'Reads GitHub Issues as read-only Cradle external issue cards.',
    capabilities: { refresh: true },
    readSnapshot: readGitHubIssuesSnapshot,
  }
}

export function resolveGitHubIssuesSourceConfig(ctx: ExternalIssueSourceReadContext | null = null): GitHubIssuesSourceConfig {
  const sharedApiBaseUrl = ctx?.sharedConfig.get('GITHUB_API_BASE_URL')?.trim()
  const apiBaseUrl = stripTrailingSlash(
    sharedApiBaseUrl
    || process.env.CRADLE_GITHUB_API_BASE_URL?.trim()
    || DEFAULT_API_BASE_URL,
  )
  const token = process.env.CRADLE_GITHUB_ISSUES_TOKEN?.trim()
    || ctx?.sharedConfig.get('GITHUB_ISSUES_TOKEN')?.trim()
    || null
  const rawMax = ctx?.sharedConfig.get('GITHUB_ISSUES_MAX_PER_REPO')?.trim()
    || process.env.CRADLE_GITHUB_ISSUES_MAX_PER_REPO?.trim()
  const parsedMax = rawMax ? Number.parseInt(rawMax, 10) : DEFAULT_MAX_PER_REPO
  const maxPerRepo = Number.isFinite(parsedMax) && parsedMax > 0
    ? Math.min(parsedMax, 1000)
    : DEFAULT_MAX_PER_REPO
  return { apiBaseUrl, token, maxPerRepo }
}

export async function readGitHubIssuesSnapshot(ctx: ExternalIssueSourceReadContext): Promise<ExternalIssueSourceSnapshot> {
  const config = resolveGitHubIssuesSourceConfig(ctx)
  const repositoryOwner = ctx.repository.owner.trim()
  const repositoryName = ctx.repository.name.trim()
  if (!repositoryOwner || !repositoryName) {
    return {
      source: { status: 'error', message: 'GitHub repository owner and name are required.' },
      issues: [],
      warnings: [{ code: 'github_repository_required', message: 'Repository owner and name are required.', severity: 'error' }],
    }
  }

  const warnings: ExternalIssueWarning[] = []
  const issues: ExternalIssueRecord[] = []
  let nextUrl: string | null = buildIssuesUrl(config.apiBaseUrl, repositoryOwner, repositoryName)
  let etag: string | undefined
  let rateLimitRemaining: number | undefined
  let rateLimitResetAt: number | undefined
  let notModified = false

  while (nextUrl && issues.length < config.maxPerRepo) {
    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: buildHeaders(config, ctx.etag),
      signal: ctx.signal,
    })
    etag = response.headers.get('etag') ?? etag
    rateLimitRemaining = readIntegerHeader(response.headers, 'x-ratelimit-remaining') ?? rateLimitRemaining
    rateLimitResetAt = readIntegerHeader(response.headers, 'x-ratelimit-reset') ?? rateLimitResetAt

    if (response.status === 304) {
      notModified = true
      break
    }

    if (response.status === 403 || response.status === 429) {
      const message = await readErrorMessage(response)
      return {
        source: {
          status: 'error',
          message,
          etag,
          rateLimit: { remaining: rateLimitRemaining, resetAt: rateLimitResetAt },
        },
        issues: [],
        warnings: [{ code: 'github_rate_limited', message, severity: 'error' }],
      }
    }

    if (!response.ok) {
      const message = await readErrorMessage(response)
      return {
        source: {
          status: 'error',
          message,
          etag,
          rateLimit: { remaining: rateLimitRemaining, resetAt: rateLimitResetAt },
        },
        issues: [],
        warnings: [{ code: 'github_request_failed', message, severity: 'error' }],
      }
    }

    const payload = await response.json()
    if (!Array.isArray(payload)) {
      return {
        source: {
          status: 'error',
          message: 'GitHub Issues response was not an array.',
          etag,
          rateLimit: { remaining: rateLimitRemaining, resetAt: rateLimitResetAt },
        },
        issues: [],
        warnings: [{ code: 'github_invalid_response', message: 'GitHub Issues response was not an array.', severity: 'error' }],
      }
    }

    for (const raw of payload as GitHubIssueRecord[]) {
      if (issues.length >= config.maxPerRepo) { break }
      if (raw.pull_request) { continue }
      const mapped = mapGitHubIssue(repositoryOwner, repositoryName, raw, warnings)
      if (mapped) {
        issues.push(mapped)
      }
    }

    nextUrl = issues.length >= config.maxPerRepo ? null : parseNextLink(response.headers.get('link'))
  }

  if (issues.length >= config.maxPerRepo) {
    warnings.push({
      code: 'github_issue_limit_reached',
      message: `Stopped after ${config.maxPerRepo} GitHub issues for ${repositoryOwner}/${repositoryName}.`,
      severity: 'info',
    })
  }

  return {
    source: {
      status: warnings.some(warning => warning.severity === 'error') ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
      message: notModified
        ? `${repositoryOwner}/${repositoryName} has not changed.`
        : `Fetched ${issues.length} GitHub issues from ${repositoryOwner}/${repositoryName}.`,
      observedAt: new Date().toISOString(),
      notModified,
      etag,
      cursor: {},
      rateLimit: { remaining: rateLimitRemaining, resetAt: rateLimitResetAt },
    },
    inventory: { repositories: 1, issues: issues.length },
    issues,
    warnings,
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function buildIssuesUrl(apiBaseUrl: string, owner: string, repo: string): string {
  const url = new URL(`${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`)
  url.searchParams.set('state', 'all')
  url.searchParams.set('per_page', String(PAGE_SIZE))
  url.searchParams.set('sort', 'updated')
  url.searchParams.set('direction', 'desc')
  return url.toString()
}

function buildHeaders(config: GitHubIssuesSourceConfig, etag?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Cradle-GitHub-Issues-Plugin',
  }
  if (config.token) {
    headers.authorization = `Bearer ${config.token}`
  }
  if (etag) {
    headers['if-none-match'] = etag
  }
  return headers
}

function mapGitHubIssue(
  repositoryOwner: string,
  repositoryName: string,
  raw: GitHubIssueRecord,
  warnings: ExternalIssueWarning[],
): ExternalIssueRecord | null {
  const number = typeof raw.number === 'number' ? raw.number : null
  const title = typeof raw.title === 'string' ? raw.title : null
  const externalId = typeof raw.node_id === 'string' && raw.node_id
    ? raw.node_id
    : typeof raw.id === 'number'
      ? String(raw.id)
      : null
  if (number == null || title == null || externalId == null) {
    warnings.push({
      code: 'github_issue_skipped',
      message: 'Skipped a GitHub issue because it was missing number, title, or id.',
      severity: 'warning',
    })
    return null
  }
  return {
    externalId,
    externalKey: `${repositoryOwner}/${repositoryName}#${number}`,
    externalUrl: raw.html_url,
    repository: { owner: repositoryOwner, name: repositoryName },
    number,
    title,
    body: raw.body ?? null,
    state: raw.state === 'closed' ? 'closed' : 'open',
    labels: normalizeLabels(raw.labels),
    assignees: (raw.assignees ?? []).flatMap(user => typeof user.login === 'string' && user.login ? [user.login] : []),
    milestone: raw.milestone?.title ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? null,
    metadata: {},
    warnings: [],
  }
}

function normalizeLabels(labels: Array<string | GitHubIssueLabel> | undefined): string[] {
  return (labels ?? []).flatMap((label) => {
    if (typeof label === 'string') {
      return label ? [label] : []
    }
    return typeof label.name === 'string' && label.name ? [label.name] : []
  })
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) { return null }
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/)
    if (match?.[2] === 'next') {
      return match[1] ?? null
    }
  }
  return null
}

function readIntegerHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (!value) { return undefined }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json()
    if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
      return payload.message
    }
  }
 catch {
    // Fall through to status text.
  }
  return response.statusText || `GitHub request failed with status ${response.status}.`
}
