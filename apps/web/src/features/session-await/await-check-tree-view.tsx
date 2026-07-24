import { RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'

import { cn } from '~/lib/cn'

import type { AwaitCheckTreeNode } from './await-check-tree'
import {
  countVisibleAwaitCheckRows,
  isExpandableAwaitCheckNode,
} from './await-check-tree'
import { AwaitStatusIcon } from './await-status-icon'

const TREE_INDENT = 14
const ROW_HEIGHT = 22
const CORNER_RADIUS = 5
const STROKE_WIDTH = 1.5
const TRUNK_X = STROKE_WIDTH / 2
const BRANCH_END = TREE_INDENT + 5

export interface AwaitCheckTreeViewProps {
  nodes: readonly AwaitCheckTreeNode[]
  expandedNodeIds: ReadonlySet<string>
  onToggleNode: (nodeId: string) => void
  onBypassCheck: (checkName: string) => void
  bypassingCheckName?: string | null
}

export function AwaitCheckTreeView({
  nodes,
  expandedNodeIds,
  onToggleNode,
  onBypassCheck,
  bypassingCheckName,
}: AwaitCheckTreeViewProps) {
  const offsets: number[] = []
  let visibleRows = 0
  for (const node of nodes) {
    offsets.push(visibleRows)
    visibleRows += countVisibleAwaitCheckRows(node, expandedNodeIds)
  }

  const connectorPath = (() => {
    if (offsets.length === 0) {
      return ''
    }
    const commands: string[] = []
    const lastIndex = offsets.length - 1
    const lastMidY = offsets[lastIndex] * ROW_HEIGHT + ROW_HEIGHT / 2
    commands.push(
      `M ${TRUNK_X} 0 L ${TRUNK_X} ${lastMidY - CORNER_RADIUS}`,
      `Q ${TRUNK_X} ${lastMidY} ${TRUNK_X + CORNER_RADIUS} ${lastMidY} L ${BRANCH_END} ${lastMidY}`,
    )
    for (let index = 0; index < lastIndex; index += 1) {
      const midY = offsets[index] * ROW_HEIGHT + ROW_HEIGHT / 2
      commands.push(
        `M ${TRUNK_X} ${midY - CORNER_RADIUS} Q ${TRUNK_X} ${midY} ${TRUNK_X + CORNER_RADIUS} ${midY} L ${BRANCH_END} ${midY}`,
      )
    }
    return commands.join(' ')
  })()

  return (
    <div className="relative" style={{ paddingLeft: TREE_INDENT }}>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={TREE_INDENT}
        height={visibleRows * ROW_HEIGHT}
        aria-hidden
      >
        <path
          d={connectorPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground/12"
        />
      </svg>

      <div className="ml-1.25">
        {nodes.map((node) => {
          const hasChildren = node.children.length > 0
          const isExpandable = isExpandableAwaitCheckNode(node)
          const isExpanded = !isExpandable || expandedNodeIds.has(node.id)
          const statusIcon = node.run
            ? <AwaitStatusIcon kind="run" status={node.run.status} conclusion={node.run.conclusion} />
            : node.workflowJob
              ? <AwaitStatusIcon kind="run" status={node.workflowJob.status} conclusion={node.workflowJob.conclusion} />
              : node.step
                ? <AwaitStatusIcon kind="step" status={node.step.status} conclusion={node.step.conclusion} />
                : hasChildren
                  ? <span className="size-2 shrink-0 rounded-full bg-foreground/40" />
                  : null
          const content = (
            <>
              {statusIcon}
              <span
                className={cn(
                  'truncate text-[11px]',
                  node.run || node.workflowJob || node.step
                    ? 'text-foreground/80'
                    : 'font-medium text-muted-foreground',
                )}
              >
                {node.label}
              </span>
              {node.run && (
                <span className="shrink-0 rounded bg-muted/60 px-1 text-[9px] text-muted-foreground/50">
                  {node.run.required ? 'req' : 'opt'}
                </span>
              )}
              {node.run && !node.run.required && node.run.status !== 'completed' && (
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded px-1 text-[9px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
                  disabled={bypassingCheckName === node.run.name}
                  onClick={(event) => {
                    event.stopPropagation()
                    onBypassCheck(node.run!.name)
                  }}
                >
                  bypass
                </button>
              )}
              {isExpandable && (
                <m.span
                  className="ml-auto inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/60"
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  aria-hidden
                >
                  <ChevronRightIcon className="size-3" />
                </m.span>
              )}
            </>
          )

          return (
            <div key={node.id}>
              {isExpandable
                ? (
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1 text-left transition-colors duration-150 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      style={{ height: ROW_HEIGHT }}
                      aria-expanded={isExpanded}
                      onClick={() => onToggleNode(node.id)}
                    >
                      {content}
                    </button>
                  )
                : (
                    <div
                      className={cn(
                        'flex min-w-0 items-center gap-1.5',
                        node.step && 'ml-0.5',
                      )}
                      style={{ height: ROW_HEIGHT }}
                    >
                      {content}
                    </div>
                  )}

              <AnimatePresence initial={false}>
                {hasChildren && isExpanded && (
                  <m.div
                    initial={isExpandable ? { height: 0, opacity: 0, y: -2 } : false}
                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -2 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                    style={{ marginLeft: 3 }}
                  >
                    <AwaitCheckTreeView
                      nodes={node.children}
                      expandedNodeIds={expandedNodeIds}
                      onToggleNode={onToggleNode}
                      onBypassCheck={onBypassCheck}
                      bypassingCheckName={bypassingCheckName}
                    />
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
