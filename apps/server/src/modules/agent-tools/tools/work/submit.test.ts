import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeWorkSubmitTool,
  WORK_SUBMIT_TOOL_DESCRIPTION,
} from './submit'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('work_submit Agent tool', () => {
  it('uses mandatory closed-loop finalization language', () => {
    expect(WORK_SUBMIT_TOOL_DESCRIPTION).toContain('You MUST call this tool')
    expect(WORK_SUBMIT_TOOL_DESCRIPTION).toContain('MUST NOT claim completion')
    expect(WORK_SUBMIT_TOOL_DESCRIPTION).toContain('Draft pull request')
  })

  it('submits Work through the owning HTTP API', async () => {
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

    const result = await executeWorkSubmitTool({
      workId: 'work-1',
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
    expect(result.content[0]?.text).toContain('submitted')
    expect(result.content[0]?.text).toContain('pull/42')
  })

  it('returns a mandatory remediation result when Work is not ready', async () => {
    vi.stubEnv('CRADLE_SERVER_URL', 'http://127.0.0.1:21423')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      code: 'work_checkout_dirty',
      message: 'Commit or discard all Work changes before submitting delivery',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }))

    const result = await executeWorkSubmitTool({
      workId: 'work-1',
      title: 'Submit Work',
      summary: 'Implemented closed-loop submit.',
      testPlan: 'Run focused tests.',
    })

    expect(result).toMatchObject({ isError: true })
    expect(result.content[0]?.text).toContain('Do not claim completion')
    expect(result.content[0]?.text).toContain('work_checkout_dirty')
    expect(result.content[0]?.text).toContain('work_submit')
  })
})
