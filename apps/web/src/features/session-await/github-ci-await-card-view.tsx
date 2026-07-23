import { useEffect, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

import {
  buildAwaitCheckTree,
  collectAutoExpandedAwaitCheckNodeIds,
} from './await-check-tree'
import { AwaitCheckTreeView } from './await-check-tree-view'
import { AwaitStatusIcon } from './await-status-icon'
import { GitHubIcon } from './github-icon'
import type { LiveCIStatus } from './use-live-await-status'

export interface GitHubCIAwaitCardViewProps {
  ci: LiveCIStatus
  onBypassCheck: (checkName: string) => void
  bypassingCheckName?: string | null
}

export function GitHubCIAwaitCardView({
  ci,
  onBypassCheck,
  bypassingCheckName,
}: GitHubCIAwaitCardViewProps) {
  const tree = buildAwaitCheckTree(ci.checkRuns, ci.workflowRuns)
  const autoExpandedNodeIds = collectAutoExpandedAwaitCheckNodeIds(tree)
  const autoExpandedKey = autoExpandedNodeIds.slice().sort().join('\0')
  const autoExpandedNodeIdsRef = useRef(autoExpandedNodeIds)
  autoExpandedNodeIdsRef.current = autoExpandedNodeIds
  const previousAutoExpandedRef = useRef(new Set(autoExpandedNodeIds))
  const [expandedNodeIds, setExpandedNodeIds] = useState(
    () => new Set(autoExpandedNodeIds),
  )

  useEffect(() => {
    const nextAutoExpanded = new Set(autoExpandedNodeIdsRef.current)
    const previousAutoExpanded = previousAutoExpandedRef.current

    setExpandedNodeIds((current) => {
      const next = new Set(current)
      for (const nodeId of previousAutoExpanded) {
        if (!nextAutoExpanded.has(nodeId)) {
          next.delete(nodeId)
        }
      }
      for (const nodeId of nextAutoExpanded) {
        if (!previousAutoExpanded.has(nodeId)) {
          next.add(nodeId)
        }
      }
      return next
    })
    previousAutoExpandedRef.current = nextAutoExpanded
  }, [autoExpandedKey])

  if (!ci.hasToken) {
    return (
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <GitHubIcon />
          <span>GitHub token not available</span>
        </div>
      </div>
    )
  }

  const targetLabel = ci.prNumber ? null : ci.ref.slice(0, 12)
  const summaryText = ci.noCIConfigured || ci.totalCount === 0
    ? 'No checks or statuses found yet'
    : ci.allCompleted && ci.allPassed
      ? `All ${ci.totalCount} checks/statuses passed`
      : ci.allCompleted
        ? `Completed with ${ci.failureCount} failing`
        : ci.failureCount > 0
          ? `${ci.pendingCount} pending, ${ci.failureCount} failing`
          : `${ci.pendingCount} pending`

  const toggleNode = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      }
      else {
        next.add(nodeId)
      }
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <GitHubIcon className="shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-foreground/90">
            {ci.prNumber && (
              <span className="text-muted-foreground/60">
                #
                {ci.prNumber}
              </span>
            )}
            {ci.prNumber && ' '}
            {ci.prTitle ?? `${ci.owner}/${ci.repo}`}
            {targetLabel && (
              <span className="text-muted-foreground/60">
                {' @'}
                {targetLabel}
              </span>
            )}
          </span>
          <span
            className={cn(
              'block truncate text-[10px]',
              ci.allCompleted
                ? ci.allPassed
                  ? 'text-green-500'
                  : 'text-red-500'
                : 'text-muted-foreground/70',
            )}
          >
            {summaryText}
          </span>
        </div>
      </div>

      {tree.length > 0 && (
        <div className="px-3 pb-2">
          <div className="ml-1.25">
            <AwaitCheckTreeView
              nodes={tree}
              expandedNodeIds={expandedNodeIds}
              onToggleNode={toggleNode}
              onBypassCheck={onBypassCheck}
              bypassingCheckName={bypassingCheckName}
            />
          </div>
        </div>
      )}

      {ci.statuses.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {ci.statuses.map(status => (
            <div key={status.context} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              <AwaitStatusIcon kind="commit" status={status.state} />
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                {status.context}
              </span>
              <span
                className={cn(
                  'shrink-0 capitalize',
                  status.state === 'success'
                    ? 'text-green-500'
                    : status.state === 'pending'
                      ? 'text-amber-500'
                      : 'text-red-500',
                )}
              >
                {status.state}
              </span>
            </div>
          ))}
        </div>
      )}

      {ci.totalCount === 0 && tree.length === 0 && (
        <div className="px-3 pb-2 text-[11px] text-muted-foreground">
          No checks or statuses found yet
        </div>
      )}
    </div>
  )
}
