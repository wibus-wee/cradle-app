import { useMemo } from 'react'

import type { NodeAccess, NodeGrantScope } from './types'
import { FULL_NODE_ACCESS } from './types'
import { useNodes } from './use-nodes'

/**
 * Derive this Controller's access level over a Node from the directory's
 * caller-effective `scopes` (`GET /nodes` already filters by grant).
 *
 * `null`/`undefined` nodeId means local execution and always has full access.
 * A Node missing from the cached directory (still loading, or not granted)
 * keeps full access so the composer is not gated on a transient state; the
 * target Node remains the authority that rejects scope-insensitive commands.
 */
export function useNodeAccess(nodeId: string | null | undefined): NodeAccess {
  const { data: nodes } = useNodes()
  return useMemo(() => {
    if (!nodeId) {
      return FULL_NODE_ACCESS
    }
    const node = nodes?.find(candidate => candidate.nodeId === nodeId)
    const scopes = node?.scopes
    if (!node || !scopes) {
      return FULL_NODE_ACCESS
    }
    const has = (scope: NodeGrantScope) => scopes.includes(scope)
    const canAdmin = has('admin')
    const canControl = canAdmin || has('control')
    const canApprove = canAdmin || has('approve')
    const canView = canControl || canApprove || has('view')
    const highest: NodeGrantScope | null = canAdmin
      ? 'admin'
      : canControl
        ? 'control'
        : canApprove
          ? 'approve'
          : canView
            ? 'view'
            : null
    return { scope: highest, canView, canControl, canApprove, canAdmin }
  }, [nodeId, nodes])
}

/** Whether composer/approval controls must be disabled for this access level. */
export function nodeAccessDisablesInteraction(access: NodeAccess): boolean {
  return !access.canControl && !access.canApprove
}
