import type { QueryClient } from '@tanstack/react-query'

import {
  getSessionGroupsByIdQueryKey,
  getSessionGroupsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'

/**
 * Session Group projection gateway — the sole owner of Session Group cache
 * topology.
 *
 * Session Group business projections live in React Query under two families:
 *
 * - `list`   — `GET /session-groups` filtered variants (workspace /
 *   linkedIssueId / archived)
 * - `detail` — `GET /session-groups/:id`
 *
 * Callers reconcile mutations through `refreshSessionGroupProjections` instead
 * of composing raw query keys, so Issue–execution association transitions and
 * membership edits cannot drift across filtered list variants.
 */

export function sessionGroupsQueryKey(workspaceId?: string | null) {
  return getSessionGroupsQueryKey(
    workspaceId
      ? { query: { workspaceId } }
      : undefined,
  )
}

export function sessionGroupDetailQueryKey(groupId: string) {
  return getSessionGroupsByIdQueryKey({ path: { id: groupId } })
}

function isSessionGroupsListQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return head !== null
    && typeof head === 'object'
    && (head as { _id?: unknown })._id === 'getSessionGroups'
}

function isSessionGroupDetailQueryKey(queryKey: readonly unknown[], groupId: string): boolean {
  const head = queryKey[0]
  if (head === null || typeof head !== 'object') {
    return false
  }
  const descriptor = head as { _id?: unknown, path?: { id?: unknown } }
  return descriptor._id === 'getSessionGroupsById' && descriptor.path?.id === groupId
}

/**
 * Refresh Session Group projections: every cached list variant, and the
 * detail projection when a `groupId` is supplied. Used after group mutations
 * and after Issue–execution association transitions that re-link a group.
 */
export function refreshSessionGroupProjections(
  queryClient: QueryClient,
  input: { groupId?: string } = {},
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({
      predicate: query => isSessionGroupsListQueryKey(query.queryKey),
    }),
    ...(input.groupId
      ? [queryClient.invalidateQueries({
          predicate: query => isSessionGroupDetailQueryKey(query.queryKey, input.groupId!),
        })]
      : []),
  ]).then(() => {})
}
