import { describe, expect, it } from 'vitest'

import { describeGitHubAwaitTargetInputIssue, parseGitHubAwaitTargetInput } from './await-github'

describe('parseGitHubAwaitTargetInput', () => {
  it('parses a PR number target', () => {
    expect(parseGitHubAwaitTargetInput('42')).toEqual({
      kind: 'pull-request',
      filter: { pr: 42 },
      label: '#42',
    })
  })

  it('parses a commit ref target', () => {
    expect(parseGitHubAwaitTargetInput('feature/checks')).toEqual({
      kind: 'commit-ref',
      filter: { sha: 'feature/checks' },
      label: '@feature/checks',
    })
  })

  it('parses a GitHub check run URL into runs_id', () => {
    expect(parseGitHubAwaitTargetInput('https://github.com/acme/app/runs/101?check_suite_focus=true')).toEqual({
      kind: 'check-run',
      filter: { runs_id: 101 },
      label: '/runs/101',
    })
  })

  it('does not treat a workflow run URL as a check run', () => {
    expect(parseGitHubAwaitTargetInput('https://github.com/acme/app/actions/runs/201')).toBeNull()
  })

  it('explains unsupported workflow run URLs', () => {
    expect(describeGitHubAwaitTargetInputIssue('https://github.com/acme/app/actions/runs/201', 'github-ci'))
      .toBe('GitHub Actions workflow run URLs are not supported. Paste a check run URL or use the PR number.')
  })

  it('explains review target requirements', () => {
    expect(describeGitHubAwaitTargetInputIssue('feature/checks', 'github-review'))
      .toBe('Review awaits require a pull request number.')
  })
})
