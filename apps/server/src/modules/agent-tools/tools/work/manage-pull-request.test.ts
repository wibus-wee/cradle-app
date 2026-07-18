import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeManagePullRequestTool,
  MANAGE_PULL_REQUEST_TOOL_DESCRIPTION,
} from './manage-pull-request'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('manage_pull_request Agent tool', () => {
  it('uses mandatory closed-loop finalization language and names all actions', () => {
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('You MUST call this tool')
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('MUST NOT claim completion')
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('starts as a draft')
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('never changes its draft/ready state')
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('create_pr')
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('update_pr')
    expect(MANAGE_PULL_REQUEST_TOOL_DESCRIPTION).toContain('rename_branch')
  })

  it('creates or updates the Draft PR through the owning HTTP API', async () => {
    vi.stubEnv('CRADLE_SERVER_URL', 'http://127.0.0.1:21423')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      work: {
        id: 'work-1',
        preparedAt: 20,
        lastSubmittedAt: 21,
        handoffTitle: 'Submit Work',
      },
      readiness: {
        clean: true,
        commitsAhead: 2,
      },
      pullRequest: {
        owner: 'cradle',
        repo: 'app',
        number: 42,
        url: 'https://github.com/cradle/app/pull/42',
        isDraft: true,
        state: 'open',
        headRef: 'work/submit-loop',
        headSha: 'abc123',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const result = await executeManagePullRequestTool({
      workId: 'work-1',
      action: 'create_pr',
      title: 'Submit Work',
      summary: 'Implemented closed-loop submit.',
      testPlan: 'Run focused tests.',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/works/work-1/submit', 'http://127.0.0.1:21423'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'Submit Work',
          summary: 'Implemented closed-loop submit.',
          testPlan: 'Run focused tests.',
        }),
      }),
    )
    expect(result).toMatchObject({
      structuredContent: {
        workId: 'work-1',
        submitted: true,
        clean: true,
        commitsAhead: 2,
        pullRequest: {
          owner: 'cradle',
          repo: 'app',
          number: 42,
          url: 'https://github.com/cradle/app/pull/42',
        },
      },
    })
    expect(result?.content[0]?.text).toContain('Pull request delivered')
    expect(result?.content[0]?.text).toContain('pull/42')
  })

  it('renames the branch through the owning HTTP API', async () => {
    vi.stubEnv('CRADLE_SERVER_URL', 'http://127.0.0.1:21423')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      work: { id: 'work-1' },
      execution: { worktreeBranch: 'cradle/wt/x' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const result = await executeManagePullRequestTool({
      workId: 'work-1',
      action: 'rename_branch',
      branchName: 'cradle/wt/x',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/works/work-1/branch', 'http://127.0.0.1:21423'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ branch: 'cradle/wt/x' }),
      }),
    )
    expect(result).toMatchObject({
      structuredContent: {
        workId: 'work-1',
        branch: 'cradle/wt/x',
      },
    })
    expect(result?.content[0]?.text).toContain('cradle/wt/x')
  })

  it('rejects create_pr without a title before any HTTP call', async () => {
    vi.stubEnv('CRADLE_SERVER_URL', 'http://127.0.0.1:21423')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await executeManagePullRequestTool({
      workId: 'work-1',
      action: 'create_pr',
      summary: 'Implemented closed-loop submit.',
      testPlan: 'Run focused tests.',
    })

    expect(result).toMatchObject({ isError: true })
    expect(result?.content[0]?.text).toContain('title')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects rename_branch without a branchName before any HTTP call', async () => {
    vi.stubEnv('CRADLE_SERVER_URL', 'http://127.0.0.1:21423')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await executeManagePullRequestTool({
      workId: 'work-1',
      action: 'rename_branch',
    })

    expect(result).toMatchObject({ isError: true })
    expect(result?.content[0]?.text).toContain('branchName')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a mandatory remediation result when the server rejects with 409', async () => {
    vi.stubEnv('CRADLE_SERVER_URL', 'http://127.0.0.1:21423')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'work_checkout_dirty',
      message: 'Commit or discard all Work changes before submitting delivery',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }))

    const result = await executeManagePullRequestTool({
      workId: 'work-1',
      action: 'create_pr',
      title: 'Submit Work',
      summary: 'Implemented closed-loop submit.',
      testPlan: 'Run focused tests.',
    })

    expect(result).toMatchObject({ isError: true })
    expect(result?.content[0]?.text).toContain('Do not claim completion')
    expect(result?.content[0]?.text).toContain('work_checkout_dirty')
    expect(result?.content[0]?.text).toContain('manage_pull_request')
  })
})
