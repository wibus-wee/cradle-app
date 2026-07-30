import { describe, expect, it } from 'vitest'

import { resolvePullRequestErrorKind } from './pull-request-error'

describe('resolvePullRequestErrorKind', () => {
  it('maps github_auth_required to cli-auth-required', () => {
    expect(resolvePullRequestErrorKind({ code: 'github_auth_required' })).toBe('cli-auth-required')
  })

  it('maps github_app_connection_expired to app-connection-expired', () => {
    expect(resolvePullRequestErrorKind({ code: 'github_app_connection_expired' })).toBe('app-connection-expired')
  })

  it('reads nested API error codes', () => {
    expect(resolvePullRequestErrorKind({ error: { code: 'github_repository_access_denied' } })).toBe('repository-access-denied')
  })

  it('returns unknown for unrecognized codes', () => {
    expect(resolvePullRequestErrorKind({ code: 'not_found' })).toBe('unknown')
    expect(resolvePullRequestErrorKind(new Error('network'))).toBe('unknown')
  })
})
