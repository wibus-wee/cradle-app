import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchPullRequestDetail,
  fetchPullRequestFiles,
  markPullRequestReady,
  resetTokenCache,
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
