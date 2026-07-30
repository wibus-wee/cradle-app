import { readApiErrorCode } from '~/lib/api-error'

export type PullRequestErrorKind
  = | 'cli-auth-required'
    | 'app-connection-expired'
    | 'app-unconfigured'
    | 'repository-access-unavailable'
    | 'repository-access-denied'
    | 'pr-unavailable'
    | 'pr-request-failed'
    | 'api-error'
    | 'unknown'

const PULL_REQUEST_ERROR_KIND_BY_CODE = {
  github_auth_required: 'cli-auth-required',
  github_app_connection_expired: 'app-connection-expired',
  github_app_unconfigured: 'app-unconfigured',
  github_repository_access_unavailable: 'repository-access-unavailable',
  github_repository_access_denied: 'repository-access-denied',
  github_pr_unavailable: 'pr-unavailable',
  github_pr_request_failed: 'pr-request-failed',
  github_api_error: 'api-error',
} as const satisfies Record<string, PullRequestErrorKind>

export function resolvePullRequestErrorKind(error: unknown): PullRequestErrorKind {
  const code = readApiErrorCode(error)
  if (!code) {
    return 'unknown'
  }

  return PULL_REQUEST_ERROR_KIND_BY_CODE[code as keyof typeof PULL_REQUEST_ERROR_KIND_BY_CODE] ?? 'unknown'
}
