import { describe, expect, it } from 'vitest'

import { githubPullRequestReferenceKey, parseGitHubPullRequestReference } from './github-pull-request-reference'

describe('parseGitHubPullRequestReference', () => {
  it.each([
    'https://github.com/cradle/app/pull/70',
    'https://github.com/cradle/app/pull/70/files',
    'cradle/app#70',
    'cradle/app/pull/70',
  ])('parses %s', (value) => {
    expect(parseGitHubPullRequestReference(value)).toEqual({
      owner: 'cradle',
      repo: 'app',
      number: 70,
    })
  })

  it.each([
    '',
    'github.com/cradle/app/pull/70',
    'https://gitlab.com/cradle/app/pull/70',
    'https://github.com/cradle/app/issues/70',
    'cradle/app#0',
  ])('rejects %s', (value) => {
    expect(parseGitHubPullRequestReference(value)).toBeNull()
  })

  it('normalizes owner and repository casing for identity checks', () => {
    expect(githubPullRequestReferenceKey({ owner: 'Cradle', repo: 'App', number: 70 }))
      .toBe('cradle/app#70')
  })
})
