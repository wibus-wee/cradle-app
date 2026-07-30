import { describe, expect, it } from 'vitest'

import { buildWorkPullRequestBody, withCradlePullRequestFooter } from './pr-body'

describe('buildWorkPullRequestBody', () => {
  it('emits the Agent PR template shape used by CI format checks', () => {
    const body = buildWorkPullRequestBody({
      summary: 'Adds PR body template and format CI.',
      testPlan: 'Run check-pr-body.mjs against fixture bodies.',
    })

    expect(body).toContain('## Author type')
    expect(body).toContain('- [x] I am an Agent (check this if an LLM agent authored this PR)')
    expect(body).toContain('- [ ] I am a human')
    expect(body).toContain('## Summary')
    expect(body).toContain('Adds PR body template and format CI.')
    expect(body).toContain('## Test plan')
    expect(body).toContain('Run check-pr-body.mjs against fixture bodies.')
    expect(body).toContain('## Agent handoff')
    expect(body).toContain('<!-- agent-handoff:begin -->')
    expect(body).toContain('### Instructions for reviewing agents')
    expect(body).toContain('### Authoring context')
    expect(body).toContain('### Sharing consent (author side)')
    expect(body).toContain('<!-- agent-handoff:end -->')
    expect(body).toContain('author-side sharing consent pending')
  })

  it('records author-side sharing consent when provided', () => {
    const body = buildWorkPullRequestBody({
      summary: 'Ship handoff fields.',
      testPlan: 'Focused unit tests.',
      authorSideSharingConsent: 'allowed',
      authoringContext: {
        userGoal: 'Write an Agent-oriented PR template with CI.',
        constraints: 'Do not invent new Work handoff API fields yet.',
      },
    })

    expect(body).toContain('- [x] Author-side user allowed putting directive context in this PR for review assistance')
    expect(body).toContain('- [ ] Author-side user declined')
    expect(body).toContain('Write an Agent-oriented PR template with CI.')
    expect(body).toContain('Do not invent new Work handoff API fields yet.')
  })
})

describe('withCradlePullRequestFooter', () => {
  it('appends Cradle attribution once', () => {
    const once = withCradlePullRequestFooter('## Summary\nHi')
    expect(once).toContain('https://cradle.wibus.ren')
    expect(withCradlePullRequestFooter(once)).toBe(once.trim())
  })
})
