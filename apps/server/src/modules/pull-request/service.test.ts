import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetTokenCache } from '../../lib/github-api'
import { isForceWithLeaseRejection, resolveDeliveryPushArgs } from './delivery-push'
import { parseGitHubOwnerRepo } from './github-remote'
import { fetchPullRequestDetailByRef } from './service'

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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pullRequest), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
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
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'success', total_count: 0, statuses: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const detail = await fetchPullRequestDetailByRef('cradle', 'app', 14)

    expect(detail.pullRequest.reviewers).toEqual([
      { login: 'pending', avatarUrl: 'https://avatars.example/pending', url: 'https://github.com/pending' },
      { login: 'reviewed', avatarUrl: 'https://avatars.example/reviewed', url: 'https://github.com/reviewed' },
      { login: 'submitted', avatarUrl: 'https://avatars.example/submitted', url: 'https://github.com/submitted' },
    ])
  })
})
