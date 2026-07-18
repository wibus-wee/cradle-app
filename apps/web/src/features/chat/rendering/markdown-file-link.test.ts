import { describe, expect, it } from 'vitest'

import { parseGitHubPullRequestFromHref } from './github-pull-request-link'

describe('parseGitHubPullRequestFromHref', () => {
  it('parses a GitHub pull request URL', () => {
    expect(parseGitHubPullRequestFromHref('https://github.com/cradle/app/pull/42')).toEqual({
      owner: 'cradle',
      repo: 'app',
      number: 42,
    })
  })

  it('parses links to pull request sub-pages', () => {
    expect(
      parseGitHubPullRequestFromHref(
        'https://www.github.com/cradle/app/pull/42/files?short_path=abc',
      ),
    ).toEqual({
      owner: 'cradle',
      repo: 'app',
      number: 42,
    })
  })

  it('rejects non-pull-request and non-GitHub URLs', () => {
    expect(parseGitHubPullRequestFromHref('https://github.com/cradle/app/issues/42')).toBeNull()
    expect(parseGitHubPullRequestFromHref('https://example.com/cradle/app/pull/42')).toBeNull()
    expect(
      parseGitHubPullRequestFromHref('https://github.com/cradle/app/pull/not-a-number'),
    ).toBeNull()
  })
})
