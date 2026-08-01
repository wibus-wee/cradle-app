import { describe, expect, it } from 'vitest'

import { buildWorkPullRequestBody, withCradlePullRequestFooter } from './pr-body'

describe('buildWorkPullRequestBody', () => {
  it('emits the Agent PR template shape used by CI format checks', () => {
    const body = buildWorkPullRequestBody({
      problem: 'Reviewers were judging Agent PRs by taste because pressure was missing from the handoff.',
      summary: 'Adds PR body template and format CI.',
      testPlan: 'Run check-pr-body.mjs against fixture bodies.',
    })

    expect(body).toContain('## Author type')
    expect(body).toContain('- [x] I am an Agent (check this if an LLM agent authored this PR)')
    expect(body).toContain('- [ ] I am a human')
    expect(body).toContain('## Problem / pressure')
    expect(body).toContain('Reviewers were judging Agent PRs by taste because pressure was missing from the handoff.')
    expect(body).toContain('## Summary')
    expect(body).toContain('Adds PR body template and format CI.')
    expect(body).toContain('## Test plan')
    expect(body).toContain('Run check-pr-body.mjs against fixture bodies.')
    expect(body).toContain('## Agent handoff')
    expect(body).toContain('<!-- agent-handoff:begin -->')
    expect(body).toContain('### Instructions for reviewing agents')
    expect(body).toContain('Read **Problem / pressure** first')
    expect(body).toContain('### Authoring context')
    expect(body).toContain('### Sharing consent (author side)')
    expect(body).toContain('<!-- agent-handoff:end -->')
    expect(body).toContain('author-side sharing consent pending')
  })

  it('falls back to summary for Problem / pressure when problem is omitted', () => {
    const body = buildWorkPullRequestBody({
      summary: 'Temporary dual-use handoff narrative.',
      testPlan: 'Focused unit tests.',
    })
    expect(body).toContain('## Problem / pressure\n\nTemporary dual-use handoff narrative.')
    expect(body).toContain('## Summary\n\nTemporary dual-use handoff narrative.')
  })

  it('extracts semantic fields when summary contains an embedded PR template', () => {
    const body = buildWorkPullRequestBody({
      summary: [
        '## Author type',
        '',
        '- [x] I am an Agent',
        '- [ ] I am a human',
        '',
        '## Problem / pressure',
        '',
        'The Work handoff was already formatted as a PR body.',
        '',
        '## Summary',
        '',
        '- Add the requested native client.',
        '',
        '## Agent handoff',
        '',
        'Legacy handoff content that must not be embedded.',
      ].join('\n'),
      testPlan: 'Run focused PR body tests.',
    })

    expect(body.match(/^## Author type$/gm)).toHaveLength(1)
    expect(body.match(/^## Problem \/ pressure$/gm)).toHaveLength(1)
    expect(body.match(/^## Summary$/gm)).toHaveLength(1)
    expect(body.match(/^## Test plan$/gm)).toHaveLength(1)
    expect(body.match(/^## Agent handoff$/gm)).toHaveLength(1)
    expect(body).toContain('## Problem / pressure\n\nThe Work handoff was already formatted as a PR body.')
    expect(body).toContain('## Summary\n\n- Add the requested native client.')
    expect(body).not.toContain('Legacy handoff content that must not be embedded.')
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
