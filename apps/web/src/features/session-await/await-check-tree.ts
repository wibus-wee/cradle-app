import type {
  LiveCheckRun,
  LiveWorkflowJob,
  LiveWorkflowJobStep,
  LiveWorkflowRun,
} from './use-live-await-status'

const MAX_TREE_DEPTH = 3

export interface AwaitCheckTreeNode {
  id: string
  label: string
  run: LiveCheckRun | null
  workflowJob: LiveWorkflowJob | null
  step: LiveWorkflowJobStep | null
  children: AwaitCheckTreeNode[]
}

interface TreeIndexEntry {
  node: AwaitCheckTreeNode
  childIndex: Map<string, TreeIndexEntry>
}

function createStepNode(
  parentId: string,
  step: LiveWorkflowJobStep,
): AwaitCheckTreeNode {
  return {
    id: `${parentId}-step-${step.number}-${step.name}`,
    label: step.name,
    run: null,
    workflowJob: null,
    step,
    children: [],
  }
}

function createWorkflowJobNode(job: LiveWorkflowJob): AwaitCheckTreeNode {
  return {
    id: `workflow-job-${job.id}`,
    label: job.name,
    run: null,
    workflowJob: job,
    step: null,
    children: job.steps.map(step => createStepNode(`workflow-job-${job.id}`, step)),
  }
}

export function buildAwaitCheckTree(
  runs: readonly LiveCheckRun[],
  workflowRuns: readonly LiveWorkflowRun[],
): AwaitCheckTreeNode[] {
  const root: AwaitCheckTreeNode[] = []
  const rootIndex = new Map<string, TreeIndexEntry>()
  const visibleWorkflowJobIds = new Set<number>()

  for (const run of runs) {
    if (run.workflowJobId) {
      visibleWorkflowJobIds.add(run.workflowJobId)
    }
    const segments = run.name.split(' / ').map(segment => segment.trim())
    const limited = segments.length > MAX_TREE_DEPTH
      ? [
          ...segments.slice(0, MAX_TREE_DEPTH - 1),
          segments.slice(MAX_TREE_DEPTH - 1).join(' / '),
        ]
      : segments

    let currentLevel = root
    let currentIndex = rootIndex
    for (let index = 0; index < limited.length; index += 1) {
      const segment = limited[index]
      const isLeaf = index === limited.length - 1
      let entry = currentIndex.get(segment)

      if (!entry) {
        const node: AwaitCheckTreeNode = {
          id: `run-${run.id ?? run.name}-part-${limited.slice(0, index + 1).join('/')}`,
          label: segment,
          run: isLeaf ? run : null,
          workflowJob: null,
          step: null,
          children: isLeaf
            ? run.steps.map(step => createStepNode(`run-${run.id ?? run.name}`, step))
            : [],
        }
        entry = { node, childIndex: new Map() }
        currentLevel.push(node)
        currentIndex.set(segment, entry)
      }
      else if (isLeaf) {
        entry.node.run = run
        entry.node.children = run.steps.map(step =>
          createStepNode(`run-${run.id ?? run.name}`, step))
      }
      currentLevel = entry.node.children
      currentIndex = entry.childIndex
    }
  }

  for (const workflowRun of workflowRuns) {
    const unmatchedJobs = workflowRun.jobs.filter(job =>
      !visibleWorkflowJobIds.has(job.id))
    if (unmatchedJobs.length === 0) {
      continue
    }
    root.push({
      id: `workflow-run-${workflowRun.id}`,
      label: workflowRun.displayTitle
        ?? workflowRun.name
        ?? `Workflow run #${workflowRun.runNumber}`,
      run: null,
      workflowJob: null,
      step: null,
      children: unmatchedJobs.map(createWorkflowJobNode),
    })
  }

  return root
}

export function isExpandableAwaitCheckNode(node: AwaitCheckTreeNode): boolean {
  return (!!node.run || !!node.workflowJob) && node.children.length > 0
}

export function collectAutoExpandedAwaitCheckNodeIds(
  nodes: readonly AwaitCheckTreeNode[],
): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    const isInProgress = node.run
      ? node.run.status !== 'completed'
      : node.workflowJob
        ? node.workflowJob.status !== 'completed'
        : false
    if (isExpandableAwaitCheckNode(node) && isInProgress) {
      ids.push(node.id)
    }
    ids.push(...collectAutoExpandedAwaitCheckNodeIds(node.children))
  }
  return ids
}

export function countVisibleAwaitCheckRows(
  node: AwaitCheckTreeNode,
  expandedNodeIds: ReadonlySet<string>,
): number {
  if (isExpandableAwaitCheckNode(node) && !expandedNodeIds.has(node.id)) {
    return 1
  }
  return 1 + node.children.reduce(
    (count, child) =>
      count + countVisibleAwaitCheckRows(child, expandedNodeIds),
    0,
  )
}
