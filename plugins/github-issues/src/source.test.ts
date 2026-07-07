import { afterEach, describe, expect, it, vi } from 'vitest'

import { readGitHubIssuesSnapshot, resolveGitHubIssuesSourceConfig } from './source'

function makeContext(overrides: Partial<Parameters<typeof readGitHubIssuesSnapshot>[0]> = {}): Parameters<typeof readGitHubIssuesSnapshot>[0] {
  return {
    signal: new AbortController().signal,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    sharedConfig: new Map(),
    repository: { owner: 'owner', name: 'repo' },
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', headers.get('content-type') ?? 'application/json')
  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
    ...init,
  })
}

describe('gitHub Issues source', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CRADLE_GITHUB_API_BASE_URL
    delete process.env.CRADLE_GITHUB_ISSUES_TOKEN
    delete process.env.CRADLE_GITHUB_ISSUES_MAX_PER_REPO
  })

  it('maps GitHub issues, filters pull requests, and sends auth and conditional headers', async () => {
    process.env.CRADLE_GITHUB_ISSUES_TOKEN = 'token-value'
    const fetchMock = vi.fn(async () => jsonResponse([
      {
        node_id: 'I_node_1',
        html_url: 'https://github.com/owner/repo/issues/1',
        number: 1,
        title: 'Issue one',
        body: 'Body',
        state: 'open',
        labels: [{ name: 'bug' }, 'triage'],
        assignees: [{ login: 'wibus' }],
        milestone: { title: 'M1' },
        created_at: '2026-06-08T00:00:00Z',
        updated_at: '2026-06-08T01:00:00Z',
      },
      {
        node_id: 'PR_node_2',
        number: 2,
        title: 'Pull request',
        state: 'open',
        pull_request: {},
      },
    ], {
      headers: {
        'etag': '"etag-1"',
        'x-ratelimit-remaining': '4999',
        'x-ratelimit-reset': '1780000000',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await readGitHubIssuesSnapshot(makeContext({ etag: '"old-etag"' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const [, init] = call
    expect(init?.headers).toEqual(expect.objectContaining({
      'authorization': 'Bearer token-value',
      'if-none-match': '"old-etag"',
    }))
    expect(snapshot.source).toEqual(expect.objectContaining({
      status: 'ok',
      etag: '"etag-1"',
      rateLimit: { remaining: 4999, resetAt: 1780000000 },
    }))
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        externalId: 'I_node_1',
        externalKey: 'owner/repo#1',
        title: 'Issue one',
        labels: ['bug', 'triage'],
        assignees: ['wibus'],
        milestone: 'M1',
      }),
    ])
  })

  it('follows pagination until the configured issue limit', async () => {
    process.env.CRADLE_GITHUB_ISSUES_MAX_PER_REPO = '2'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page=2')) {
        return jsonResponse([
          { node_id: 'I_node_2', number: 2, title: 'Issue two', state: 'closed' },
        ])
      }
      return jsonResponse([
        { node_id: 'I_node_1', number: 1, title: 'Issue one', state: 'open' },
      ], {
        headers: {
          link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next"',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await readGitHubIssuesSnapshot(makeContext())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(snapshot.issues.map(issue => issue.externalKey)).toEqual(['owner/repo#1', 'owner/repo#2'])
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'github_issue_limit_reached' }),
    ]))
  })

  it('returns notModified snapshots for GitHub 304 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 304,
      headers: {
        'etag': '"same"',
        'x-ratelimit-remaining': '4998',
      },
    })))

    const snapshot = await readGitHubIssuesSnapshot(makeContext({ etag: '"same"' }))

    expect(snapshot.source.notModified).toBe(true)
    expect(snapshot.source.status).toBe('ok')
    expect(snapshot.issues).toEqual([])
  })

  it('reports rate-limit responses with reset metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'API rate limit exceeded' }, {
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1780000100',
      },
    })))

    const snapshot = await readGitHubIssuesSnapshot(makeContext())

    expect(snapshot.source.status).toBe('error')
    expect(snapshot.source.rateLimit).toEqual({ remaining: 0, resetAt: 1780000100 })
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'github_rate_limited', severity: 'error' }),
    ])
  })

  it('resolves config from env and shared config', () => {
    process.env.CRADLE_GITHUB_API_BASE_URL = 'https://api.github.example/'
    process.env.CRADLE_GITHUB_ISSUES_TOKEN = 'env-token'
    process.env.CRADLE_GITHUB_ISSUES_MAX_PER_REPO = '17'
    const sharedConfig = new Map([
      ['GITHUB_API_BASE_URL', 'https://shared.example/api/'],
      ['GITHUB_ISSUES_TOKEN', 'shared-token'],
      ['GITHUB_ISSUES_MAX_PER_REPO', '3'],
    ])

    expect(resolveGitHubIssuesSourceConfig(makeContext({ sharedConfig }))).toEqual({
      apiBaseUrl: 'https://shared.example/api',
      token: 'env-token',
      maxPerRepo: 3,
    })
  })

  it('falls back to host-provided GitHub token when plugin token env is absent', () => {
    const sharedConfig = new Map([
      ['GITHUB_ISSUES_TOKEN', 'shared-token'],
    ])

    expect(resolveGitHubIssuesSourceConfig(makeContext({ sharedConfig })).token).toBe('shared-token')
  })
})
