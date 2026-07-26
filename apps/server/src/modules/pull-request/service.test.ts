import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitHubApiError, resetTokenCache } from '../../lib/github-api'
import { isForceWithLeaseRejection, resolveDeliveryPushArgs } from './delivery-push'
import { parseGitHubOwnerRepo } from './github-remote'
import { fetchPullRequestDetailByRef, listReviewingPullRequests, mapGitHubError } from './service'

const originalGitHubToken = process.env.GH_TOKEN

describe('parseGitHubOwnerRepo', () => {
  it('parses HTTPS GitHub URLs', () => {
    expect(parseGitHubOwnerRepo('https://github.com/acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    })
  })

  it('parses SSH GitHub URLs', () => {
    expect(parseGitHubOwnerRepo('git@github.com:acme/widgets.git')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    })
  })

  it('rejects non-GitHub remotes', () => {
    expect(parseGitHubOwnerRepo('https://gitlab.com/acme/widgets.git')).toBeNull()
  })
})

describe('resolveDeliveryPushArgs', () => {
  it('uses an ordinary upstream push when the remote branch is absent', () => {
    expect(resolveDeliveryPushArgs({
      branch: 'cradle/wt/example',
      remoteSha: null,
    })).toEqual(['--set-upstream'])
  })

  it('uses force-with-lease against the observed remote tip for republish', () => {
    expect(resolveDeliveryPushArgs({
      branch: 'cradle/wt/example',
      remoteSha: 'abc1234def',
    })).toEqual([
      '--set-upstream',
      '--force-with-lease=cradle/wt/example:abc1234def',
    ])
  })
})

describe('isForceWithLeaseRejection', () => {
  it('recognizes non-fast-forward and lease rejection messages', () => {
    expect(isForceWithLeaseRejection('! [rejected] non-fast-forward')).toBe(true)
    expect(isForceWithLeaseRejection('stale info')).toBe(true)
    expect(isForceWithLeaseRejection('rejected\nhint: fetch first')).toBe(true)
    expect(isForceWithLeaseRejection('error: failed to push some refs')).toBe(false)
    expect(isForceWithLeaseRejection('authentication failed')).toBe(false)
  })
})

describe('fetchPullRequestDetailByRef', () => {
  beforeEach(() => {
    process.env.GH_TOKEN = 'test-token'
    resetTokenCache()
  })

  afterEach(() => {
    if (originalGitHubToken === undefined) {
      delete process.env.GH_TOKEN
    }
    else {
      process.env.GH_TOKEN = originalGitHubToken
    }
    resetTokenCache()
    vi.unstubAllGlobals()
  })

  it('combines requested and submitted reviewers into one de-duplicated list', async () => {
    const pullRequest = {
      number: 14,
      title: 'Fix retries',
      body: null,
      state: 'open',
      draft: false,
      merged: false,
      mergeable: true,
      mergeable_state: 'clean',
      html_url: 'https://github.com/cradle/app/pull/14',
      user: { login: 'author', avatar_url: 'https://avatars.example/author', html_url: 'https://github.com/author' },
      head: { sha: 'head-sha', ref: 'feature' },
      base: { ref: 'main' },
      additions: 12,
      deletions: 3,
      changed_files: 1,
      commits: 2,
      comments: 0,
      review_comments: 0,
      created_at: '2026-07-10T10:00:00Z',
      updated_at: '2026-07-11T10:00:00Z',
      closed_at: null,
      merged_at: null,
      requested_reviewers: [
        { login: 'pending', avatar_url: 'https://avatars.example/pending', html_url: 'https://github.com/pending' },
        { login: 'reviewed', avatar_url: 'https://avatars.example/reviewed', html_url: 'https://github.com/reviewed' },
      ],
      assignees: [],
      labels: [],
    }
    const reviews = [{
      id: 1,
      user: { login: 'reviewed', avatar_url: 'https://avatars.example/reviewed', html_url: 'https://github.com/reviewed' },
      state: 'APPROVED',
      commit_id: 'head-sha',
      submitted_at: '2026-07-11T11:00:00Z',
      body: null,
      html_url: 'https://github.com/cradle/app/pull/14#pullrequestreview-1',
    }, {
      id: 2,
      user: { login: 'submitted', avatar_url: 'https://avatars.example/submitted', html_url: 'https://github.com/submitted' },
      state: 'COMMENTED',
      commit_id: 'head-sha',
      submitted_at: '2026-07-11T12:00:00Z',
      body: 'Looks good',
      html_url: 'https://github.com/cradle/app/pull/14#pullrequestreview-2',
    }]
    // Route by URL: detail uses Promise.all, so Once-order mocks race.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/pulls/14/reviews')) {
        return new Response(JSON.stringify(reviews), { status: 200 })
      }
      if (url.includes('/pulls/14/files') || url.includes('/issues/14/comments')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('/pulls/14')) {
        return new Response(JSON.stringify(pullRequest), { status: 200 })
      }
      if (url.includes('/repos/cradle/app') && !url.includes('/pulls/') && !url.includes('/commits/')) {
        return new Response(JSON.stringify({
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: false,
        }), { status: 200 })
      }
      if (url.includes('/check-runs')) {
        return new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 })
      }
      if (url.includes('/status')) {
        return new Response(JSON.stringify({ state: 'success', total_count: 0, statuses: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ message: `unmocked ${url}` }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const detail = await fetchPullRequestDetailByRef('cradle', 'app', 14)

    expect(detail.pullRequest.reviewers).toEqual([
      { login: 'pending', avatarUrl: 'https://avatars.example/pending', url: 'https://github.com/pending' },
      { login: 'reviewed', avatarUrl: 'https://avatars.example/reviewed', url: 'https://github.com/reviewed' },
      { login: 'submitted', avatarUrl: 'https://avatars.example/submitted', url: 'https://github.com/submitted' },
    ])
  })

  it('reports repository access failures without leaking a GitHub 404 as a server error', async () => {
    expect(() => mapGitHubError(new GitHubApiError({
      status: 404,
      path: '/repos/private-owner/private-repo',
      message: 'Not Found',
    }), 'Failed to fetch pull request details.')).toThrow(expect.objectContaining({
      code: 'github_repository_access_unavailable',
      status: 403,
    }))
  })
})

function searchPullRequestNode(options: {
  number: number
  updatedAt: string
}) {
  return {
    number: options.number,
    title: `Pull request ${options.number}`,
    url: `https://github.com/cradle/app/pull/${options.number}`,
    isDraft: false,
    state: 'OPEN',
    headRefName: `feature-${options.number}`,
    baseRefName: 'main',
    additions: 1,
    deletions: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: options.updatedAt,
    repository: { name: 'app', owner: { login: 'cradle' } },
    author: {
      login: 'author',
      avatarUrl: 'https://avatars.example/author',
      url: 'https://github.com/author',
    },
    commits: { nodes: [] },
  }
}

function searchResponse(options: {
  nodes: ReturnType<typeof searchPullRequestNode>[]
  hasNextPage: boolean
  endCursor: string | null
}): Response {
  return new Response(JSON.stringify({
    data: {
      search: {
        nodes: options.nodes,
        pageInfo: {
          hasNextPage: options.hasNextPage,
          endCursor: options.endCursor,
        },
      },
    },
  }), { status: 200 })
}

describe('listReviewingPullRequests', () => {
  beforeEach(() => {
    process.env.GH_TOKEN = 'test-token'
    resetTokenCache()
  })

  afterEach(() => {
    if (originalGitHubToken === undefined) {
      delete process.env.GH_TOKEN
    }
    else {
      process.env.GH_TOKEN = originalGitHubToken
    }
    resetTokenCache()
    vi.unstubAllGlobals()
  })

  it('merges requested and completed review searches with independent cursors', async () => {
    const sharedPullRequest = searchPullRequestNode({
      number: 1,
      updatedAt: '2026-07-15T03:00:00Z',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(searchResponse({
        nodes: [sharedPullRequest],
        hasNextPage: true,
        endCursor: 'requested-page-1',
      }))
      .mockResolvedValueOnce(searchResponse({
        nodes: [
          sharedPullRequest,
          searchPullRequestNode({ number: 2, updatedAt: '2026-07-15T02:00:00Z' }),
        ],
        hasNextPage: false,
        endCursor: null,
      }))
      .mockResolvedValueOnce(searchResponse({
        nodes: [searchPullRequestNode({ number: 3, updatedAt: '2026-07-15T01:00:00Z' })],
        hasNextPage: false,
        endCursor: null,
      }))
    vi.stubGlobal('fetch', fetchMock)

    const firstPage = await listReviewingPullRequests('review-feed-pagination-test')

    expect(firstPage.items.map(item => item.number)).toEqual([1, 2])
    expect(firstPage.hasNextPage).toBe(true)
    expect(firstPage.endCursor).not.toBeNull()

    const secondPage = await listReviewingPullRequests(
      'review-feed-pagination-test',
      firstPage.endCursor ?? undefined,
    )

    expect(secondPage.items.map(item => item.number)).toEqual([3])
    expect(secondPage).toMatchObject({ hasNextPage: false, endCursor: null })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const requests = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as {
        variables: { searchQuery: string, first: number, after: string | null }
      }
      return body.variables
    })
    expect(requests).toEqual([
      {
        searchQuery: 'is:pr review-requested:review-feed-pagination-test sort:updated-desc',
        first: 25,
        after: null,
      },
      {
        searchQuery: 'is:pr reviewed-by:review-feed-pagination-test -review-requested:review-feed-pagination-test sort:updated-desc',
        first: 25,
        after: null,
      },
      {
        searchQuery: 'is:pr review-requested:review-feed-pagination-test sort:updated-desc',
        first: 25,
        after: 'requested-page-1',
      },
    ])
  })
})
