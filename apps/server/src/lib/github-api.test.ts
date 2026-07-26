import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initializeDatabase, shutdownInfra } from '../infra'
import { resetGitHubAuthProviderForTests, setGitHubAuthProvider } from './github/auth-provider'
import { cachedGitHubRead, clearGitHubReadInFlight } from './github/cache-gate'
import {
  createPullRequestReviewThread,
  fetchPullRequestDetail,
  fetchPullRequestFiles,
  fetchPullRequestReviewThreads,
  markPullRequestReady,
  mergePullRequest,
  replyToPullRequestReviewThread,
  resetTokenCache,
  resolveGitHubToken,
  resolvePullRequestReviewThread,
  searchAuthoredPullRequests,
} from './github-api'
import { getCached } from './github-cache'

const originalGitHubToken = process.env.GH_TOKEN
const originalDataDir = process.env.CRADLE_DATA_DIR

describe('gitHub App identity', () => {
  let dataDir = ''

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-github-api-'))
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.GH_TOKEN = 'legacy-token'
    initializeDatabase()
    resetTokenCache()
  })

  afterEach(() => {
    resetGitHubAuthProviderForTests()
    clearGitHubReadInFlight()
    resetTokenCache()
    vi.unstubAllGlobals()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (originalDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = originalDataDir
    }
    if (originalGitHubToken === undefined) {
      delete process.env.GH_TOKEN
    }
    else {
      process.env.GH_TOKEN = originalGitHubToken
    }
  })

  it('selects the connected App identity ahead of the legacy environment token', async () => {
    setGitHubAuthProvider(async () => ({
      accessToken: 'app-user-token',
      cacheKey: 'app-user-identity-v1',
      source: 'github-app',
    }))

    await expect(resolveGitHubToken()).resolves.toBe('app-user-token')
  })

  it('namespaces authenticated cache data with a non-secret identity version', async () => {
    setGitHubAuthProvider(async () => ({
      accessToken: 'app-user-token',
      cacheKey: 'app-user-identity-v1',
      source: 'github-app',
    }))

    await expect(cachedGitHubRead({
      cacheKey: 'github-app-test-read',
      etag: false,
      fetcher: async () => ({ data: { ok: true }, status: 200 }),
    })).resolves.toEqual({ ok: true })

    expect(getCached<{ ok: boolean }>('github-app-test-read:identity:app-user-identity-v1')?.data).toEqual({ ok: true })
    expect(getCached('github-app-test-read:identity:app-user-token')).toBeNull()
  })

  it('keeps head commit and check state in the authored pull request feed', async () => {
    setGitHubAuthProvider(async () => ({
      accessToken: 'app-user-token',
      cacheKey: 'app-user-identity-v1',
      source: 'github-app',
    }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        search: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{
            number: 1,
            title: 'Verify App attribution',
            url: 'https://github.com/cradleapp/test/pull/1',
            isDraft: false,
            state: 'OPEN',
            headRefName: 'smoke',
            baseRefName: 'main',
            additions: 3,
            deletions: 0,
            createdAt: '2026-07-25T15:19:07Z',
            updatedAt: '2026-07-25T15:19:07Z',
            repository: { name: 'test', owner: { login: 'cradleapp' } },
            author: {
              login: 'wibus-wee',
              avatarUrl: 'https://avatars.example/wibus-wee',
              url: 'https://github.com/wibus-wee',
            },
            commits: {
              nodes: [{
                commit: {
                  oid: 'head-sha',
                  statusCheckRollup: { state: 'SUCCESS' },
                },
              }],
            },
          }],
        },
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(searchAuthoredPullRequests('wibus-wee')).resolves.toMatchObject({
      items: [{ headSha: 'head-sha', checksState: 'success' }],
      hasNextPage: false,
    })

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(request.query).toContain('commits(last: 1)')
    expect(request.query).toContain('statusCheckRollup { state }')
  })
})

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
    const pull = {
      node_id: 'PR_node_id',
      number: 14,
      title: 'Fix retries',
      state: 'open',
      draft: false,
      merged: false,
      mergeable: true,
      mergeable_state: 'clean',
      html_url: 'https://github.com/cradle/app/pull/14',
      head: { sha: 'head-sha', ref: 'feature' },
      base: { ref: 'main' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...pull, draft: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { number: 14 },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pull), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(markPullRequestReady('cradle', 'app', 14)).resolves.toMatchObject({
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
      expect.objectContaining({ method: 'GET' }),
    )
    const graphQlRequest = fetchMock.mock.calls[1]
    expect(graphQlRequest?.[0]).toBe('https://api.github.com/graphql')
    expect(JSON.parse(graphQlRequest?.[1]?.body as string)).toEqual(expect.objectContaining({
      variables: { pullRequestId: 'PR_node_id' },
      query: expect.stringContaining('markPullRequestReadyForReview'),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.github.com/repos/cradle/app/pulls/14',
      expect.objectContaining({ method: 'GET' }),
    )
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

  it('forwards optional commit title and message to GitHub', async () => {
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
      commitTitle: 'feat: thing (#70)',
      commitMessage: 'Detailed message',
    })).resolves.toMatchObject({ merged: true })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/cradle/app/pulls/70/merge',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          merge_method: 'squash',
          commit_title: 'feat: thing (#70)',
          commit_message: 'Detailed message',
        }),
      }),
    )
  })
})
