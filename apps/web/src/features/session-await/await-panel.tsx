import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  GitCommitLine as GitCommitHorizontalIcon,
  GitPullRequestLine as GitPullRequestIcon,
  Magic2Line as WandSparklesIcon,
  Message1Line as MessageSquareCheckIcon,
  PlusLine as PlusIcon,
  RightSmallLine as ChevronRightIcon,
  WarningLine as MessageSquareWarningIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, m } from 'motion/react'
import type { FormEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

import {
  getSessionAwaitsOptions,
  getSessionAwaitsQueryKey,
  getSessionAwaitsSummaryQueryKey,
  postSessionAwaitsByIdCancelMutation,
  postSessionAwaitsByIdRetryDeliveryMutation,
  postSessionAwaitsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionAwaitsResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import type { GitFileStatus, GitRemote } from '~/features/git/types'
import { useGitRemotes, useGitRepositories } from '~/features/git/use-git'
import { cn } from '~/lib/cn'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

import {
  derivePullRequestNumberFromStatus,
  describeGitHubAwaitTargetInputIssue,
  parseGitHubAwaitTargetInput,
  parseGitHubRepositoryInput,
  selectGitHubRepository,
} from './await-github'
import type {
  GitHubReviewMode,
  LiveAwaitStatus,
  LiveCheckRun,
  LiveCIStatus,
  LiveCommitStatus,
  LiveReviewStatus,
  LiveWorkflowJob,
  LiveWorkflowJobStep,
  LiveWorkflowRun,
  UnsupportedLiveAwaitStatus,
} from './use-live-await-status'
import { prefetchLiveAwaitStatus, useLiveAwaitStatus } from './use-live-await-status'

// ── Types ──

type AwaitRow = GetSessionAwaitsResponse[number]
type GitHubAwaitSourceKind = 'github-ci' | 'github-review'

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeGitRemotes(value: unknown): GitRemote[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value
    .filter((remote): remote is { fetchUrl?: unknown, name: string, pushUrl?: unknown } => {
      return remote !== null && typeof remote === 'object' && typeof (remote as { name?: unknown }).name === 'string'
    })
    .map(remote => ({
      name: remote.name,
      fetchUrl: readNullableString(remote.fetchUrl),
      pushUrl: readNullableString(remote.pushUrl),
    }))
}

interface NormalizedGitStatus {
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  isDetached: boolean
  files: Array<{ path: string, status: GitFileStatus['status'] }>
}

function normalizeGitStatus(value: unknown): NormalizedGitStatus | null {
  if (value === null || typeof value !== 'object') {
    return null
  }
  const status = value as {
    ahead?: unknown
    behind?: unknown
    branch?: unknown
    files?: unknown
    isDetached?: unknown
    tracking?: unknown
  }
  if (typeof status.branch !== 'string' || typeof status.ahead !== 'number' || typeof status.behind !== 'number' || typeof status.isDetached !== 'boolean' || !Array.isArray(status.files)) {
    return null
  }
  const fileStatuses = new Set(['added', 'modified', 'deleted', 'renamed', 'untracked'])
  return {
    branch: status.branch,
    tracking: readNullableString(status.tracking),
    ahead: status.ahead,
    behind: status.behind,
    isDetached: status.isDetached,
    files: status.files
      .filter((file): file is { path: string, status: GitFileStatus['status'] } => {
        return file !== null
          && typeof file === 'object'
          && typeof (file as { path?: unknown }).path === 'string'
          && typeof (file as { status?: unknown }).status === 'string'
          && fileStatuses.has((file as { status: string }).status)
      }),
  }
}

function useCreateGitHubAwait(sessionId: string | null, workspaceId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    ...postSessionAwaitsMutation(),
    onSuccess: (row) => {
      void prefetchLiveAwaitStatus(queryClient, row.id)
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsQueryKey({ query: { sessionId } }) })
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsSummaryQueryKey({ query: { sessionId } }) })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Failed to create await',
        description: error instanceof Error ? error.message : 'GitHub CI await could not be created',
      })
    },
    meta: { sessionId, workspaceId },
  })
}

function useCancelAwait(sessionId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    ...postSessionAwaitsByIdCancelMutation(),
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsQueryKey({ query: { sessionId } }) })
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsSummaryQueryKey({ query: { sessionId } }) })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Failed to cancel await',
        description: error instanceof Error ? error.message : 'Session await could not be cancelled',
      })
    },
  })
}

function useRetryAwaitDelivery(sessionId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    ...postSessionAwaitsByIdRetryDeliveryMutation(),
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsQueryKey({ query: { sessionId } }) })
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsSummaryQueryKey({ query: { sessionId } }) })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Failed to retry await',
        description: error instanceof Error ? error.message : 'Session await delivery could not be retried',
      })
    },
  })
}

function useBypassCheck(sessionId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ awaitId, checkName }: { awaitId: string, checkName: string }) => {
      const { client } = await import('~/lib/client.config')
      const res = await client.post({
        url: `/session-awaits/${awaitId}/bypass-check`,
        body: { checkName },
      })
      return res.data
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsQueryKey({ query: { sessionId } }) })
        void queryClient.invalidateQueries({ queryKey: getSessionAwaitsSummaryQueryKey({ query: { sessionId } }) })
      }
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Failed to bypass check',
        description: error instanceof Error ? error.message : 'Check could not be bypassed',
      })
    },
  })
}

// ── Icons ──

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={cn('size-3.5', className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function CheckRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FailRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3', className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SkippedRunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3', className)}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.75 11.25l6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RunStatusIcon({ status, conclusion }: {
  status: LiveCheckRun['status'] | LiveWorkflowJobStep['status'] | LiveWorkflowJob['status']
  conclusion: string | null
}) {
  const icon = (() => {
    if (status === 'completed') {
      if (conclusion === 'skipped' || conclusion === 'cancelled' || conclusion === 'neutral') {
        return <SkippedRunIcon className="text-muted-foreground/70" />
      }
      if (conclusion === 'success') {
        return <CheckRunIcon className="text-green-500" />
      }
      return <FailRunIcon className="text-red-500" />
    }
    return <Spinner className="size-3 text-amber-500" />
  })()

  return (
    <AnimatePresence mode="wait">
      <m.span
        key={`${status}-${conclusion}`}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="inline-flex"
      >
        {icon}
      </m.span>
    </AnimatePresence>
  )
}

function StepStatusIcon({ status, conclusion }: { status: LiveWorkflowJobStep['status'], conclusion: string | null }) {
  const icon = (() => {
    if (status === 'completed') {
      if (conclusion === 'skipped' || conclusion === 'cancelled' || conclusion === 'neutral') {
        return <SkippedRunIcon className="text-muted-foreground/70" />
      }
      if (conclusion === 'success') {
        return <CheckIcon className="size-3 !text-green-500" strokeWidth={2.2} />
      }
      return <XIcon className="size-3 !text-red-500" strokeWidth={2.1} />
    }
    return <Spinner className="size-3 text-amber-500" />
  })()

  return (
    <AnimatePresence mode="wait">
      <m.span
        key={`step-${status}-${conclusion}`}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="inline-flex"
      >
        {icon}
      </m.span>
    </AnimatePresence>
  )
}

function StatusContextIcon({ status }: { status: LiveCommitStatus }) {
  if (status.state === 'success') {
    return <CheckRunIcon className="text-green-500" />
  }
  if (status.state === 'pending') {
    return <Spinner className="size-3 text-amber-500" />
  }
  return <FailRunIcon className="text-red-500" />
}

// ── Tree structure ──

const MAX_TREE_DEPTH = 3

interface TreeNode {
  id: string
  label: string
  run: LiveCheckRun | null
  workflowJob: LiveWorkflowJob | null
  step: LiveWorkflowJobStep | null
  children: TreeNode[]
}

interface TreeIndexEntry {
  node: TreeNode
  childIndex: Map<string, TreeIndexEntry>
}

function createStepNode(parentId: string, step: LiveWorkflowJobStep): TreeNode {
  return {
    id: `${parentId}-step-${step.number}-${step.name}`,
    label: step.name,
    run: null,
    workflowJob: null,
    step,
    children: [],
  }
}

function createStepNodes(run: LiveCheckRun): TreeNode[] {
  return run.steps.map(step => createStepNode(`run-${run.id ?? run.name}`, step))
}

function createWorkflowStepNodes(job: LiveWorkflowJob): TreeNode[] {
  return job.steps.map(step => createStepNode(`workflow-job-${job.id}`, step))
}

function createWorkflowJobNode(job: LiveWorkflowJob): TreeNode {
  return {
    id: `workflow-job-${job.id}`,
    label: job.name,
    run: null,
    workflowJob: job,
    step: null,
    children: createWorkflowStepNodes(job),
  }
}

function createWorkflowRunNode(run: LiveWorkflowRun, jobs: LiveWorkflowJob[]): TreeNode {
  const label = run.displayTitle ?? run.name ?? `Workflow run #${run.runNumber}`
  return {
    id: `workflow-run-${run.id}`,
    label,
    run: null,
    workflowJob: null,
    step: null,
    children: jobs.map(createWorkflowJobNode),
  }
}

function buildRunTree(runs: LiveCheckRun[], workflowRuns: LiveWorkflowRun[]): TreeNode[] {
  const root: TreeNode[] = []
  const rootIndex = new Map<string, TreeIndexEntry>()
  const visibleWorkflowJobIds = new Set<number>()

  for (const run of runs) {
    if (run.workflowJobId) {
      visibleWorkflowJobIds.add(run.workflowJobId)
    }
    const segments = run.name.split(' / ').map(s => s.trim())
    const limited = segments.length > MAX_TREE_DEPTH
      ? [...segments.slice(0, MAX_TREE_DEPTH - 1), segments.slice(MAX_TREE_DEPTH - 1).join(' / ')]
      : segments

    let currentLevel = root
    let currentIndex = rootIndex
    for (let i = 0; i < limited.length; i++) {
      const segment = limited[i]
      const isLeaf = i === limited.length - 1
      let entry = currentIndex.get(segment)

      if (!entry) {
        const node: TreeNode = {
          id: `run-${run.id ?? run.name}-part-${limited.slice(0, i + 1).join('/')}`,
          label: segment,
          run: isLeaf ? run : null,
          workflowJob: null,
          step: null,
          children: isLeaf ? createStepNodes(run) : [],
        }
        entry = { node, childIndex: new Map() }
        currentLevel.push(node)
        currentIndex.set(segment, entry)
      }
      else if (isLeaf) {
        entry.node.run = run
        entry.node.children = createStepNodes(run)
      }
      currentLevel = entry.node.children
      currentIndex = entry.childIndex
    }
  }

  for (const workflowRun of workflowRuns) {
    const unmatchedJobs = workflowRun.jobs.filter(job => !visibleWorkflowJobIds.has(job.id))
    if (unmatchedJobs.length > 0) {
      root.push(createWorkflowRunNode(workflowRun, unmatchedJobs))
    }
  }

  return root
}

function isJobNodeInProgress(node: TreeNode): boolean {
  if (node.run) {
    return node.run.status !== 'completed'
  }
  if (node.workflowJob) {
    return node.workflowJob.status !== 'completed'
  }
  return false
}

/** Expand job detail rows only while the job is still loading; completed jobs stay collapsed by default. */
function collectAutoExpandedNodeIds(nodes: TreeNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (isExpandableJobNode(node) && isJobNodeInProgress(node)) {
      ids.push(node.id)
    }
    ids.push(...collectAutoExpandedNodeIds(node.children))
  }
  return ids
}

// ── Tree rendering with rounded connectors ──

// ── SVG Tree connector ──

const TREE_INDENT = 14
const ROW_H = 22
const CORNER_R = 5
const STROKE_W = 1.5
const TRUNK_X = STROKE_W / 2
const BRANCH_END = TREE_INDENT + 5 // extend to dot center

function isExpandableJobNode(node: TreeNode): boolean {
  return (!!node.run || !!node.workflowJob) && node.children.length > 0
}

function countVisibleRows(node: TreeNode, expandedNodeIds: Set<string>): number {
  let c = 1
  if (isExpandableJobNode(node) && !expandedNodeIds.has(node.id)) {
    return c
  }
  for (const child of node.children) {
    c += countVisibleRows(child, expandedNodeIds)
  }
  return c
}

/**
 * Build SVG path for tree connectors.
 * The trunk comes from above (parent), each node gets a rounded branch off it.
 * - All nodes (including first): trunk descends, then a rounded branch curves to the right
 * - Middle nodes: trunk continues past the branch point
 * - Last node: trunk ends at the branch curve
 * - Single node: trunk comes from top, curves to the right (no straight horizontal)
 */
function buildConnectorPath(offsets: number[]): string {
  if (offsets.length === 0) {
    return ''
  }

  const d: string[] = []
  const lastIdx = offsets.length - 1

  // Trunk: vertical line from top (y=0) to just before last node's curve
  const lastMidY = offsets[lastIdx] * ROW_H + ROW_H / 2
  d.push(`M ${TRUNK_X} 0 L ${TRUNK_X} ${lastMidY - CORNER_R}`)
  // Last node: curve out
  d.push(`Q ${TRUNK_X} ${lastMidY} ${TRUNK_X + CORNER_R} ${lastMidY} L ${BRANCH_END} ${lastMidY}`)

  // Branch curves for all nodes except last (they branch off the trunk with a curve)
  for (let i = 0; i < lastIdx; i++) {
    const midY = offsets[i] * ROW_H + ROW_H / 2
    // Small curve from trunk going right, trunk continues below
    d.push(`M ${TRUNK_X} ${midY - CORNER_R} Q ${TRUNK_X} ${midY} ${TRUNK_X + CORNER_R} ${midY} L ${BRANCH_END} ${midY}`)
  }

  return d.join(' ')
}

/** Renders the trunk line + branch connectors for a list of sibling nodes */
function TreeLevel({
  nodes,
  expandedNodeIds,
  onToggleNode,
  awaitId,
  sessionId,
}: {
  nodes: TreeNode[]
  expandedNodeIds: Set<string>
  onToggleNode: (nodeId: string) => void
  awaitId: string
  sessionId: string | null
}) {
  const offsets: number[] = []
  let acc = 0
  for (const node of nodes) {
    offsets.push(acc)
    acc += countVisibleRows(node, expandedNodeIds)
  }
  const totalH = acc * ROW_H
  const pathD = buildConnectorPath(offsets)

  return (
    <div className="relative" style={{ paddingLeft: TREE_INDENT }}>
      <svg
        className="absolute left-0 top-0 pointer-events-none overflow-visible"
        width={TREE_INDENT}
        height={totalH}
        aria-hidden
      >
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground/12"
        />
      </svg>

      <div className="ml-1.25">
        {
          nodes.map((node, i) => (
            <TreeItem
              key={node.id}
              node={node}
              isLast={i === nodes.length - 1}
              expandedNodeIds={expandedNodeIds}
              onToggleNode={onToggleNode}
              awaitId={awaitId}
              sessionId={sessionId}
            />
          ))
        }
      </div>
    </div>
  )
}

function TreeItem({
  node,
  isLast: _isLast,
  expandedNodeIds,
  onToggleNode,
  awaitId,
  sessionId,
}: {
  node: TreeNode
  isLast: boolean
  expandedNodeIds: Set<string>
  onToggleNode: (nodeId: string) => void
  awaitId: string
  sessionId: string | null
}) {
  const bypassMutation = useBypassCheck(sessionId)
  const hasChildren = node.children.length > 0
  const isExpandableJob = isExpandableJobNode(node)
  const isExpanded = !isExpandableJob || expandedNodeIds.has(node.id)

  const content = (
    <>
      {node.run && <RunStatusIcon status={node.run.status} conclusion={node.run.conclusion} />}
      {node.workflowJob && <RunStatusIcon status={node.workflowJob.status} conclusion={node.workflowJob.conclusion} />}
      {node.step && <StepStatusIcon status={node.step.status} conclusion={node.step.conclusion} />}
      {!node.run && !node.workflowJob && !node.step && hasChildren && (
        <span className="size-2 rounded-full bg-foreground/40 shrink-0" />
      )}
      <span className={cn(
        'truncate text-[11px]',
        node.run || node.workflowJob || node.step ? 'text-foreground/80' : 'text-muted-foreground font-medium',
      )}
      >
        {node.label}
      </span>
      {node.run?.required && (
        <span className="shrink-0 rounded bg-muted/60 px-1 text-[9px] text-muted-foreground/50">req</span>
      )}
      {node.run && !node.run.required && (
        <span className="shrink-0 rounded bg-muted/40 px-1 text-[9px] text-muted-foreground/40">opt</span>
      )}
      {node.run && !node.run.required && node.run.status !== 'completed' && (
        <button
          type="button"
          className="ml-auto shrink-0 rounded px-1 text-[9px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          disabled={bypassMutation.isPending}
          onClick={(e) => {
            e.stopPropagation()
            bypassMutation.mutate({ awaitId, checkName: node.run!.name })
          }}
        >
          bypass
        </button>
      )}
      {isExpandableJob && (
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
    <div>
      {isExpandableJob
        ? (
          <button
            type="button"
            className={cn(
              'flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1 text-left',
              'transition-colors duration-150 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
            )}
            style={{ height: ROW_H }}
            aria-expanded={isExpanded}
            onClick={() => onToggleNode(node.id)}
          >
            {content}
          </button>
        )
        : (
          <div className={cn('flex min-w-0 items-center gap-1.5', node.step && 'ml-0.5')} style={{ height: ROW_H }}>
            {content}
          </div>
        )}

      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <m.div
            initial={isExpandableJob ? { height: 0, opacity: 0, y: -2 } : false}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -2 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
            style={{ marginLeft: 3 }}
          >
            <TreeLevel nodes={node.children} expandedNodeIds={expandedNodeIds} onToggleNode={onToggleNode} awaitId={awaitId} sessionId={sessionId} />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Card ──

function parseResumePayload(awaitRow: AwaitRow): Record<string, unknown> | null {
  const rawPayload = awaitRow.resumePayloadJson
  if (typeof rawPayload !== 'string' || rawPayload.length === 0) {
    return null
  }
  try {
    const parsed = JSON.parse(rawPayload)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

function formatCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function describeStoredAwaitStatus(awaitRow: AwaitRow): string {
  const errorText = (awaitRow.lastErrorText as string | null) ?? null
  if (errorText) {
    return errorText
  }
  if (awaitRow.status === 'triggered') {
    const payload = parseResumePayload(awaitRow)
    if (payload?.kind === 'github-ci') {
      const totalCount = formatCount(payload.totalCount)
      const failureCount = formatCount(payload.failureCount)
      if (payload.noCIConfigured === true) {
        return 'Completed without CI signals'
      }
      if (payload.allSuccess === true) {
        return `Completed: ${totalCount} checks/statuses passed`
      }
      if (failureCount > 0) {
        return `Completed: ${failureCount} checks/statuses failed`
      }
      return 'Completed: GitHub checks finished'
    }
    if (payload?.kind === 'github-review') {
      const approvedCount = formatCount(payload.approvedCount)
      const changesRequestedCount = formatCount(payload.changesRequestedCount)
      if (changesRequestedCount > 0) {
        return `Completed: ${changesRequestedCount} changes requested`
      }
      if (approvedCount > 0) {
        return `Completed: ${approvedCount} approvals`
      }
      return 'Completed: review activity found'
    }
    return 'Completed'
  }
  if (awaitRow.status === 'failed') {
    return 'Failed'
  }
  if (awaitRow.status === 'expired') {
    return 'Expired'
  }
  if (awaitRow.status === 'cancelled') {
    return 'Cancelled'
  }
  return (awaitRow.reason as string | null) ?? 'Waiting...'
}

function SourceCard({ awaitRow, sessionId }: { awaitRow: AwaitRow, sessionId: string | null }) {
  const queryClient = useQueryClient()
  const cancelMutation = useCancelAwait(sessionId)
  const retryDeliveryMutation = useRetryAwaitDelivery(sessionId)
  const invalidatedRef = useRef(false)
  const supportsLiveStatus = awaitRow.source === 'github-ci' || awaitRow.source === 'github-review'
  const isPending = awaitRow.status === 'pending'
  const { data: rawData } = useLiveAwaitStatus(supportsLiveStatus ? awaitRow.id : null, isPending)
  const data = rawData as (LiveAwaitStatus | UnsupportedLiveAwaitStatus) | undefined

  useEffect(() => {
    if (
      data?.supported === false
      && data.error?.code === 'github_await_target_invalid'
      && !invalidatedRef.current
    ) {
      invalidatedRef.current = true
      void queryClient.invalidateQueries({ queryKey: getSessionAwaitsQueryKey({ query: { sessionId: awaitRow.chatSessionId } }) })
      void queryClient.invalidateQueries({ queryKey: getSessionAwaitsSummaryQueryKey({ query: { sessionId: awaitRow.chatSessionId } }) })
    }
  }, [awaitRow.chatSessionId, data, queryClient])

  if (!data || !data.supported) {
    const errorText = data?.error?.message ?? (awaitRow.lastErrorText as string | null) ?? null
    const statusText = errorText ?? describeStoredAwaitStatus(awaitRow)
    const hasError = !!errorText || awaitRow.status === 'failed'
    const failureKind = (awaitRow as { failureKind?: unknown }).failureKind
    const isRetryableDeliveryFailure = awaitRow.status === 'failed' && failureKind === 'delivery'

    return (
      <div className={cn(
        'relative rounded-md border p-3',
        hasError ? 'border-red-500/35 bg-red-500/[0.04]' : 'border-border',
      )}
      >
        {isPending && (
          <button
            type="button"
            onClick={() => cancelMutation.mutate({ path: { id: awaitRow.id } })}
            disabled={cancelMutation.isPending}
            className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Cancel await"
          >
            <XIcon className="size-3" />
          </button>
        )}
        <div className="space-y-1.5 text-xs">
          <div className={cn(
            'flex items-center gap-2',
            hasError ? 'text-red-500' : 'text-muted-foreground',
          )}
          >
            {hasError && <XIcon className="size-3 shrink-0" aria-hidden />}
            <span className="capitalize">{awaitRow.source}</span>
          </div>
          <span
            className={cn(
              'block min-w-0 whitespace-normal break-words leading-5',
              hasError ? 'text-red-500' : 'text-muted-foreground',
            )}
          >
            {statusText}
          </span>
          {isRetryableDeliveryFailure && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1 h-8 w-full active:scale-[0.96] transition-transform"
              disabled={retryDeliveryMutation.isPending}
              onClick={() => retryDeliveryMutation.mutate({ path: { id: awaitRow.id }, body: {} })}
            >
              {retryDeliveryMutation.isPending ? <Spinner className="size-3" /> : null}
              Retry delivery
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (data.kind === 'github-review') {
    return <GitHubReviewCard review={data} />
  }

  return <GitHubCICard ci={data} awaitId={awaitRow.id} sessionId={sessionId} />
}

function GitHubCICard({ ci, awaitId, sessionId }: { ci: LiveCIStatus, awaitId: string, sessionId: string | null }) {
  const tree = buildRunTree(ci.checkRuns, ci.workflowRuns)
  const autoExpandedNodeIds = collectAutoExpandedNodeIds(tree)
  const autoExpandedKey = autoExpandedNodeIds.slice().sort().join('\0')
  const autoExpandedNodeIdsRef = useRef(autoExpandedNodeIds)
  autoExpandedNodeIdsRef.current = autoExpandedNodeIds
  const previousAutoExpandedRef = useRef<Set<string>>(new Set(autoExpandedNodeIds))
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set(autoExpandedNodeIds))

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
  const summaryText = (() => {
    if (ci.noCIConfigured || ci.totalCount === 0) {
      return 'No checks or statuses found yet'
    }
    if (ci.allCompleted && ci.allPassed) {
      return `All ${ci.totalCount} checks/statuses passed`
    }
    if (ci.allCompleted) {
      return `Completed with ${ci.failureCount} failing`
    }
    if (ci.failureCount > 0) {
      return `${ci.pendingCount} pending, ${ci.failureCount} failing`
    }
    return `${ci.pendingCount} pending`
  })()
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
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <GitHubIcon className="shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-foreground/90 truncate block">
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
          <span className={cn(
            'block truncate text-[10px]',
            ci.allCompleted
              ? ci.allPassed ? 'text-green-500' : 'text-red-500'
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
            <TreeLevel nodes={tree} expandedNodeIds={expandedNodeIds} onToggleNode={toggleNode} awaitId={awaitId} sessionId={sessionId} />
          </div>
        </div>
      )}

      {ci.statuses.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {ci.statuses.map(status => (
            <div key={status.context} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              <StatusContextIcon status={status} />
              <span className="min-w-0 flex-1 truncate text-foreground/80">{status.context}</span>
              <span className={cn(
                'shrink-0 capitalize',
                status.state === 'success' ? 'text-green-500' : status.state === 'pending' ? 'text-amber-500' : 'text-red-500',
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

function GitHubReviewCard({ review }: { review: LiveReviewStatus }) {
  if (!review.hasToken) {
    return (
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <GitHubIcon />
          <span>GitHub token not available</span>
        </div>
      </div>
    )
  }

  const modeLabel = review.mode === 'approved'
    ? 'Waiting for approval'
    : review.mode === 'changes-requested'
      ? 'Waiting for changes requested'
      : 'Waiting for review'
  const statusLabel = review.matched
    ? review.mode === 'changes-requested'
      ? 'Changes requested'
      : review.mode === 'reviewed'
        ? 'Review activity found'
        : `Approved by ${review.approvedCount}`
    : modeLabel

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <GitHubIcon className="shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-foreground/90">
            <span className="text-muted-foreground/60">
              #
              {review.prNumber}
            </span>
            {' '}
            {review.prTitle ?? `${review.owner}/${review.repo}`}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground/70">
            {statusLabel}
            {review.headSha && ` @${review.headSha.slice(0, 12)}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3 pb-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-green-500">
          <MessageSquareCheckIcon className="size-3" aria-hidden />
          <span>
            {review.approvedCount}
            {' approved'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-red-500">
          <MessageSquareWarningIcon className="size-3" aria-hidden />
          <span>
            {review.changesRequestedCount}
            {' requested'}
          </span>
        </div>
      </div>

      {review.reviews.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {review.reviews.map(item => (
            <div key={item.id} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              {item.state === 'APPROVED'
                ? <MessageSquareCheckIcon className="size-3 shrink-0 !text-green-500" aria-hidden />
                : item.state === 'CHANGES_REQUESTED'
                  ? <MessageSquareWarningIcon className="size-3 shrink-0 !text-red-500" aria-hidden />
                  : <GitPullRequestIcon className="size-3 shrink-0 !text-muted-foreground/70" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{item.reviewer ?? 'Unknown reviewer'}</span>
              <span className="shrink-0 text-muted-foreground/70">{item.state.toLowerCase().replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GitHubAwaitComposer({
  sessionId,
  workspaceId,
}: {
  sessionId: string | null
  workspaceId: string | null
}) {
  const repositoriesQuery = useGitRepositories(workspaceId)
  const selectedRepository = repositoriesQuery.data?.length === 1 ? repositoriesQuery.data[0] : null
  const repositoryPath = selectedRepository?.path ?? null
  const { data: remotes, isLoading: gitRemotesLoading, isError: gitRemotesError } = useGitRemotes(repositoryPath ? workspaceId : null, repositoryPath)
  const remotesLoading = repositoriesQuery.isLoading || gitRemotesLoading
  const remotesError = repositoriesQuery.isError || gitRemotesError
  const detectedRepo = selectGitHubRepository(normalizeGitRemotes(remotes))
  const detectedPrNumber = derivePullRequestNumberFromStatus(normalizeGitStatus(selectedRepository))
  const [repoInput, setRepoInput] = useState('')
  const [targetInput, setTargetInput] = useState('')
  const [sourceKind, setSourceKind] = useState<GitHubAwaitSourceKind>('github-ci')
  const [reviewMode, setReviewMode] = useState<GitHubReviewMode>('approved')
  const repoEditedRef = useRef(false)
  const targetEditedRef = useRef(false)
  const repoInputId = useId()
  const targetInputId = useId()
  const mutation = useCreateGitHubAwait(sessionId, workspaceId)

  useEffect(() => {
    if (!repoEditedRef.current && detectedRepo?.fullName) {
      setRepoInput(detectedRepo.fullName)
    }
  }, [detectedRepo?.fullName])

  useEffect(() => {
    if (!targetEditedRef.current && detectedPrNumber) {
      setTargetInput(String(detectedPrNumber))
    }
  }, [detectedPrNumber])

  const parsedRepo = parseGitHubRepositoryInput(repoInput)
  const parsedTarget = parseGitHubAwaitTargetInput(targetInput)
  const targetIssue = describeGitHubAwaitTargetInputIssue(targetInput, sourceKind)
  const canCreate = !!sessionId
    && !!workspaceId
    && !!parsedRepo
    && !!parsedTarget
    && !targetIssue
    && (sourceKind === 'github-ci' || parsedTarget.kind === 'pull-request')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!sessionId || !workspaceId || !parsedRepo || !parsedTarget || !canCreate) {
      return
    }
    if (sourceKind === 'github-review') {
      if (parsedTarget.kind !== 'pull-request') {
        return
      }
      mutation.mutate({
        body: {
          chatSessionId: sessionId,
          workspaceId,
          source: 'github-review',
          filterJson: JSON.stringify({ repo: parsedRepo.fullName, pr: parsedTarget.filter.pr, mode: reviewMode }),
          reason: `Waiting for GitHub PR review on ${parsedRepo.fullName}${parsedTarget.label}`,
        },
      }, {
        onSuccess: () => {
          toastManager.add({
            type: 'success',
            title: 'GitHub review await created',
            description: `${parsedRepo.fullName}${parsedTarget.label}`,
          })
        },
      })
      return
    }

    mutation.mutate({
      body: {
        chatSessionId: sessionId,
        workspaceId,
        source: 'github-ci',
        filterJson: JSON.stringify({ repo: parsedRepo.fullName, ...parsedTarget.filter }),
        reason: `Waiting for GitHub checks on ${parsedRepo.fullName}${parsedTarget.label}`,
      },
    }, {
      onSuccess: () => {
        toastManager.add({
          type: 'success',
          title: 'GitHub checks await created',
          description: `${parsedRepo.fullName}${parsedTarget.label}`,
        })
      },
    })
  }

  const statusText = (() => {
    if (!workspaceId) {
      return 'Select a workspace-backed session to create awaits.'
    }
    if (remotesLoading) {
      return 'Reading git remotes...'
    }
    if (detectedRepo) {
      return `Detected ${detectedRepo.fullName} from ${detectedRepo.remoteName}.`
    }
    if (remotesError) {
      return 'Git remotes are unavailable; enter a GitHub repo manually.'
    }
    return 'Enter a GitHub repo manually. SSH and HTTPS remotes are supported.'
  })()

  const TargetIcon = parsedTarget?.kind === 'pull-request' ? GitPullRequestIcon : GitCommitHorizontalIcon
  const sourceLabel = sourceKind === 'github-ci' ? 'GitHub checks' : 'GitHub review'

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-[22rem] space-y-3 rounded-lg border border-border/70 bg-muted/35 p-2.5"
      data-testid="github-await-composer"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <GitHubIcon className="text-foreground/80" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">{sourceLabel}</span>
            {detectedRepo && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-primary bg-primary/10">
                <WandSparklesIcon className="size-2.5" aria-hidden />
                Detected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground text-pretty">
            {statusText}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Await</div>
          <ToggleGroup
            type="single"
            value={sourceKind}
            onValueChange={(value) => {
              if (value) {
                setSourceKind(value as GitHubAwaitSourceKind)
              }
            }}
            variant="outline"
            size="sm"
            className="grid w-full grid-cols-2 rounded-md"
            aria-label="GitHub await source"
          >
            <ToggleGroupItem value="github-ci" aria-label="GitHub checks" className="h-7 gap-1 rounded-l-md px-2 text-xs">
              <CheckRunIcon className="size-3" aria-hidden />
              Checks
            </ToggleGroupItem>
            <ToggleGroupItem value="github-review" aria-label="GitHub review" className="h-7 gap-1 rounded-r-md px-2 text-xs">
              <MessageSquareCheckIcon className="size-3" aria-hidden />
              Review
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="min-w-0 space-y-1">
          <label htmlFor={repoInputId} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Repository
          </label>
          <Input
            id={repoInputId}
            value={repoInput}
            onChange={(event) => {
              repoEditedRef.current = true
              setRepoInput(event.target.value)
            }}
            placeholder="owner/repo"
            className="h-7 rounded-md text-xs"
            aria-label="GitHub repository"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="min-w-0 space-y-1">
          <label htmlFor={targetInputId} className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {sourceKind === 'github-ci' ? 'PR, commit, or check run' : 'Pull request'}
          </label>
          <div className="relative">
            <TargetIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/70" aria-hidden />
            <Input
              id={targetInputId}
              value={targetInput}
              onChange={(event) => {
                targetEditedRef.current = true
                setTargetInput(event.target.value)
              }}
              inputMode="text"
              placeholder={sourceKind === 'github-ci' ? '123, commit sha/ref, or runs URL' : '123'}
              className="h-7 rounded-md pl-7 font-mono text-xs tabular-nums"
              aria-label={sourceKind === 'github-ci' ? 'GitHub pull request number, commit SHA/ref, or check run URL' : 'GitHub pull request number'}
              aria-invalid={targetIssue ? true : undefined}
            />
          </div>
          {targetIssue && (
            <p className="text-[11px] leading-4 text-destructive">
              {targetIssue}
            </p>
          )}
        </div>
      </div>

      {sourceKind === 'github-review' && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Review signal
          </div>
          <Select value={reviewMode} onValueChange={value => setReviewMode(value as GitHubReviewMode)}>
            <SelectTrigger size="sm" className="h-7 w-full rounded-md text-xs" aria-label="GitHub review signal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="changes-requested">Changes requested</SelectItem>
              <SelectItem value="reviewed">Any review</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        type="submit"
        size="sm"
        className="h-7 w-full rounded-md text-xs"
        disabled={!canCreate || mutation.isPending}
      >
        {mutation.isPending
          ? <Spinner className="size-3" aria-hidden />
          : <PlusIcon className="size-3" aria-hidden />}
        {sourceKind === 'github-ci' ? 'Wait for checks' : 'Wait for review'}
      </Button>
    </form>
  )
}

// ── Main Panel ──

interface AwaitPanelProps {
  sessionId: string | null
  workspaceId: string | null
}

export function AwaitPanel({ sessionId, workspaceId }: AwaitPanelProps) {
  const { data: awaits = [], isSuccess: awaitsReady } = useQuery({
    ...getSessionAwaitsOptions({ query: { sessionId: sessionId! } }),
    ...queryRefreshPolicies.interactive,
    enabled: !!sessionId,
  })
  const ready = !!sessionId && awaitsReady

  if (!sessionId) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        data-testid="right-aside-await-panel"
        data-right-aside-await-ready="false"
      >
        <p className="text-[11px] text-muted-foreground">No session selected</p>
      </div>
    )
  }

  const activeAwaits = awaits.filter(a => a.status === 'pending')
  const pastAwaits = awaits.filter(a => a.status !== 'pending')

  if (awaits.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-3"
        data-testid="right-aside-await-panel"
        data-right-aside-await-ready={ready ? 'true' : 'false'}
      >
        <GitHubAwaitComposer sessionId={sessionId} workspaceId={workspaceId} />
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto p-3 gap-y-3"
      data-testid="right-aside-await-panel"
      data-right-aside-await-ready={ready ? 'true' : 'false'}
    >
      {activeAwaits.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground/50">Active</span>
          {activeAwaits.map(a => (
            <SourceCard key={a.id} awaitRow={a} sessionId={sessionId} />
          ))}
        </div>
      )}
      {pastAwaits.length > 0 && (
        <div className="space-y-2">
          {pastAwaits.map(a => (
            <SourceCard key={a.id} awaitRow={a} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  )
}
