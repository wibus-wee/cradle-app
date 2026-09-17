import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  markSessionPullRequestReady,
  readSessionPullRequest,
} from './pull-request'

const mocks = vi.hoisted(() => ({
  getPullRequest: vi.fn(),
  markReady: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getSessionsByIdPullRequest: mocks.getPullRequest,
  postSessionsByIdPullRequestReady: mocks.markReady,
}))

const pullRequest = {
  owner: 'cradle',
  repo: 'app',
  number: 41,
  url: 'https://example.test/pull/41',
  title: 'Enforce ownership',
  isDraft: true,
  state: 'open' as const,
  merged: false,
  headRef: 'ownership',
  baseRef: 'main',
  headSha: 'abc123',
  createdAt: 1,
  updatedAt: 2,
}

describe('session pull-request gateway', () => {
  beforeEach(() => {
    mocks.getPullRequest.mockReset()
    mocks.markReady.mockReset()
  })

  it('unwraps present and absent pull-request envelopes', async () => {
    mocks.getPullRequest
      .mockResolvedValueOnce({ data: { pullRequest } })
      .mockResolvedValueOnce({ data: { pullRequest: null } })

    await expect(readSessionPullRequest('session-1')).resolves.toEqual(pullRequest)
    await expect(readSessionPullRequest('session-1')).resolves.toBeNull()
  })

  it('passes cancellation and throwing semantics to the generated transport', async () => {
    const controller = new AbortController()
    const error = new Error('HTTP 409')
    mocks.getPullRequest.mockRejectedValue(error)

    await expect(readSessionPullRequest('session-1', controller.signal)).rejects.toBe(error)
    expect(mocks.getPullRequest).toHaveBeenCalledWith({
      path: { id: 'session-1' },
      signal: controller.signal,
      throwOnError: true,
    })
  })

  it('rejects invalid success payloads before they reach feature UI', async () => {
    mocks.getPullRequest.mockResolvedValue({ data: { pullRequest: { number: 41 } } })

    await expect(readSessionPullRequest('session-1')).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('unwraps mark-ready responses and rejects an absent pull request', async () => {
    mocks.markReady
      .mockResolvedValueOnce({ data: { pullRequest: { ...pullRequest, isDraft: false } } })
      .mockResolvedValueOnce({ data: { pullRequest: null } })

    await expect(markSessionPullRequestReady('session-1')).resolves.toMatchObject({ isDraft: false })
    await expect(markSessionPullRequestReady('session-1')).rejects.toThrow('did not include a pull request')
  })
})
