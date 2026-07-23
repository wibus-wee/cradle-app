import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPullRequestReviewThread,
  fetchPullRequestDetail,
  fetchPullRequestFiles,
  fetchPullRequestReviewThreads,
  markPullRequestReady,
  mergePullRequest,
  replyToPullRequestReviewThread,
  resetTokenCache,
  resolvePullRequestReviewThread,
} from './github-api'

const originalGitHubToken = process.env.GH_TOKEN

describe('markPullRequestReady', () => {
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

  it('uses GitHub GraphQL to convert a draft pull request to ready for review', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        node_id: 'PR_node_id',
        number: 14,
        title: 'Fix retries',
        state: 'open',
        draft: true,
        merged: false,
        mergeable: true,
        mergeable_state: 'clean',
        html_url: 'https://github.com/cradle/app/pull/14',
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: {
              number: 14,
              title: 'Fix retries',
              isDraft: false,
              url: 'https://github.com/cradle/app/pull/14',
              state: 'OPEN',
              headRefName: 'feature',
              baseRefName: 'main',
              headRefOid: 'head-sha',
            },
          },
        },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(markPullRequestReady('cradle', 'app', 14)).resolves.toEqual({
      number: 14,
      title: 'Fix retries',
      draft: false,
      html_url: 'https://github.com/cradle/app/pull/14',
      state: 'open',
      head: { sha: 'head-sha', ref: 'feature' },
      base: { ref: 'main' },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/cradle/app/pulls/14',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    const graphQlRequest = fetchMock.mock.calls[1]
    expect(graphQlRequest?.[0]).toBe('https://api.github.com/graphql')
    expect(graphQlRequest?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }))
    expect(JSON.parse(graphQlRequest?.[1]?.body as string)).toEqual(expect.objectContaining({
      variables: { pullRequestId: 'PR_node_id' },
      query: expect.stringContaining('markPullRequestReadyForReview'),
    }))
  })
})

describe('pull request detail reads', () => {
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

  it('parses live pull request metadata and changed-file patches from GitHub', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        number: 14,
        title: 'Fix retries',
        body: '## Summary\nFixes retries.',
        state: 'open',
        draft: false,
        merged: false,
        mergeable: true,
        mergeable_state: 'clean',
        html_url: 'https://github.com/cradle/app/pull/14',
        user: {
          login: 'wibus',
          avatar_url: 'https://avatars.example/wibus',
          html_url: 'https://github.com/wibus',
        },
        head: { sha: 'head-sha', ref: 'feature' },
        base: { ref: 'main' },
        additions: 12,
        deletions: 3,
        changed_files: 1,
        commits: 2,
        comments: 4,
        review_comments: 1,
        created_at: '2026-07-10T10:00:00Z',
        updated_at: '2026-07-11T10:00:00Z',
        closed_at: null,
        merged_at: null,
        requested_reviewers: [],
        assignees: [],
        labels: [{ name: 'desktop', color: 'ffffff' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        sha: 'file-sha',
        filename: 'src/retry.ts',
        status: 'modified',
        additions: 12,
        deletions: 3,
        changes: 15,
        blob_url: 'https://github.com/cradle/app/blob/head/src/retry.ts',
        raw_url: 'https://github.com/cradle/app/raw/head/src/retry.ts',
        contents_url: 'https://api.github.com/repos/cradle/app/contents/src/retry.ts',
        patch: '@@ -1 +1 @@\n-old\n+new',
      }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPullRequestDetail('cradle', 'app', 14)).resolves.toMatchObject({
      number: 14,
      body: '## Summary\nFixes retries.',
      additions: 12,
      changed_files: 1,
      user: { login: 'wibus' },
    })
    await expect(fetchPullRequestFiles('cradle', 'app', 14)).resolves.toEqual([
      expect.objectContaining({
        filename: 'src/retry.ts',
        patch: '@@ -1 +1 @@\n-old\n+new',
        previous_filename: null,
      }),
    ])
  })
})

describe('pull request review threads', () => {
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

  it('reads remote threads with inline anchors and replies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            id: 'PR_70',
            reviewThreads: {
              nodes: [{
                id: 'PRRT_thread',
                isResolved: false,
                isOutdated: false,
                path: 'src/app.ts',
                line: 8,
                startLine: 6,
                diffSide: 'RIGHT',
                startDiffSide: 'RIGHT',
                comments: {
                  nodes: [{
                    id: 'PRRC_comment',
                    body: 'Please handle the failure path.',
                    url: 'https://github.com/cradle/app/pull/70#discussion_r1',
                    createdAt: '2026-07-21T10:00:00Z',
                    updatedAt: '2026-07-21T11:00:00Z',
                    author: { login: 'reviewer' },
                  }],
                },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchPullRequestReviewThreads('cradle', 'app', 70)).resolves.toEqual([{
      id: 'PRRT_thread',
      isResolved: false,
      isOutdated: false,
      path: 'src/app.ts',
      line: 8,
      startLine: 6,
      diffSide: 'RIGHT',
      startDiffSide: 'RIGHT',
      comments: [{
        id: 'PRRC_comment',
        body: 'Please handle the failure path.',
        url: 'https://github.com/cradle/app/pull/70#discussion_r1',
        createdAt: '2026-07-21T10:00:00Z',
        updatedAt: '2026-07-21T11:00:00Z',
        author: { login: 'reviewer' },
      }],
    }])
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(request.variables).toEqual({ owner: 'cradle', repo: 'app', number: 70, after: null })
    expect(request.query).toContain('reviewThreads(first: 100')
  })

  it('uses GraphQL mutations for create, reply, and resolve operations', async () => {
    const thread = {
      id: 'PRRT_thread',
      isResolved: false,
      isOutdated: false,
      path: 'src/app.ts',
      line: 8,
      startLine: null,
      diffSide: 'RIGHT',
      startDiffSide: null,
      comments: { nodes: [] },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ node_id: 'PR_70' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { addPullRequestReviewThread: { thread } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { addPullRequestReviewThreadReply: { thread } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { resolveReviewThread: { thread: { ...thread, isResolved: true } } },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await createPullRequestReviewThread({
      owner: 'cradle',
      repo: 'app',
      pullRequestNumber: 70,
      body: 'Inline comment',
      path: 'src/app.ts',
      line: 8,
      side: 'RIGHT',
    })
    await replyToPullRequestReviewThread({ threadId: 'PRRT_thread', body: 'Reply' })
    await resolvePullRequestReviewThread('PRRT_thread')

    const requests = fetchMock.mock.calls.slice(1).map(call => JSON.parse(String(call[1]?.body)))
    expect(requests[0]).toMatchObject({
      variables: {
        input: {
          pullRequestId: 'PR_70',
          body: 'Inline comment',
          path: 'src/app.ts',
          line: 8,
          side: 'RIGHT',
        },
      },
    })
    expect(requests[1].variables.input).toEqual({ pullRequestReviewThreadId: 'PRRT_thread', body: 'Reply' })
    expect(requests[2].variables.input).toEqual({ threadId: 'PRRT_thread' })
  })
})

describe('mergePullRequest', () => {
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

  it('sends the selected merge method to GitHub', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sha: 'merge-sha',
      merged: true,
      message: 'Pull Request successfully merged',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(mergePullRequest({
      owner: 'cradle',
      repo: 'app',
      pullRequestNumber: 70,
      mergeMethod: 'squash',
    })).resolves.toMatchObject({ merged: true, sha: 'merge-sha' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/cradle/app/pulls/70/merge',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ merge_method: 'squash' }),
      }),
    )
  })
})
