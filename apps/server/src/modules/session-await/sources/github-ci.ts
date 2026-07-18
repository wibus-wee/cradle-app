import { z } from 'zod'

import type { GitHubCheckRun, GitHubCommitStatus, GitHubWorkflowJob, GitHubWorkflowJobStep, GitHubWorkflowRun } from '../../../lib/github-api'
import {
  fetchBranchProtection,
  fetchCheckRun,
  fetchCheckRuns,
  fetchCombinedStatus,
  fetchPullRequest,
  fetchWorkflowRunJobs,
  fetchWorkflowRunsForHead,
  GitHubTargetValidationError,
  hasGitHubToken,
  isGitHubMissingTarget,
  isGitHubRateLimited,
  resetTokenCache,
} from '../../../lib/github-api'
import { getMatchingBypassPatterns, matchesAnyBypassPattern } from '../service'
import type { CheckResult, SessionAwait, SessionAwaitSource } from '../types'

export { resetTokenCache }

export interface LiveCheckRun {
  id: number | null
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
  required: boolean
  htmlUrl: string | null
  detailsUrl: string | null
  workflowRunId: number | null
  workflowJobId: number | null
  steps: LiveWorkflowJobStep[]
}

export interface LiveCommitStatus {
  context: string
  state: 'error' | 'failure' | 'pending' | 'success'
  description: string | null
  targetUrl: string | null
}

export interface LiveWorkflowJobStep {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'pending'
  conclusion: string | null
  number: number
  startedAt: string | null
  completedAt: string | null
}

export interface LiveWorkflowJob {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  htmlUrl: string | null
  checkRunId: number | null
  startedAt: string | null
  completedAt: string | null
  runnerName: string | null
  labels: string[]
  steps: LiveWorkflowJobStep[]
}

export interface LiveWorkflowRun {
  id: number
  name: string | null
  displayTitle: string | null
  runNumber: number
  runAttempt: number
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: string | null
  headSha: string
  htmlUrl: string | null
  createdAt: string
  updatedAt: string
  jobs: LiveWorkflowJob[]
}

export interface LiveCIStatus {
  kind: 'github-ci'
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
  checkRuns: LiveCheckRun[]
  workflowRuns: LiveWorkflowRun[]
  statuses: LiveCommitStatus[]
  totalCount: number
  pendingCount: number
  failureCount: number
  allCompleted: boolean
  allPassed: boolean
  noCIConfigured: boolean
  hasToken: boolean
}

interface ResolvedCITarget {
  owner: string
  repo: string
  prNumber: number | null
  prTitle: string | null
  ref: string
  baseBranch: string | null
  checkRunId: number | null
  currentHeadSha: string | null
  prState: 'open' | 'closed' | null
  merged: boolean
}

interface AggregatedCI {
  checkRuns: GitHubCheckRun[]
  statuses: GitHubCommitStatus[]
  totalCount: number
  pendingCount: number
  failureCount: number
  allCompleted: boolean
  allPassed: boolean
}

interface AggregatedWorkflowRuns {
  workflowRuns: GitHubWorkflowRun[]
  pendingCount: number
  failureCount: number
}

const DEFAULT_NO_CHECKS_GRACE_SECONDS = 300
const PASSING_CHECK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const FAILING_CHECK_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])
const CHECK_RUN_ID_PATTERN = /\/check-runs\/(\d+)(?:$|\?)/

const GitHubRepoSchema = z.string().min(1).regex(/^[^/]+\/[^/]+$/).transform((repoFullName) => {
    const [owner, repo] = repoFullName.split('/')
    return { owner, repo }
  })

const GitHubCIFilterSchema = z.object({
  repo: GitHubRepoSchema,
  pr: z.number().int().positive().optional(),
  sha: z.string().min(1).optional(),
  runs_id: z.number().int().positive().optional(),
  runId: z.number().int().positive().optional(),
  checkRunId: z.number().int().positive().optional(),
  mode: z.literal('all').optional(),
  headSha: z.string().min(1).optional(),
  workId: z.string().min(1).optional(),
  allowNoChecksAfterSeconds: z.number().int().nonnegative().default(DEFAULT_NO_CHECKS_GRACE_SECONDS),
}).transform((filter) => {
  const checkRunId = filter.runs_id ?? filter.checkRunId ?? filter.runId
  return { ...filter, checkRunId }
}).refine(filter => [filter.pr, filter.sha, filter.checkRunId].filter(value => value !== undefined).length === 1, {
  message: 'GitHub CI filter requires exactly one of pr, sha, or runs_id',
}).refine(filter => filter.headSha === undefined || filter.pr !== undefined, {
  message: 'GitHub CI headSha requires a PR target',
}).transform(({ repo, ...filter }) => ({
  ...filter,
  owner: repo.owner,
  repo: repo.repo,
  statusRef: filter.sha ?? '',
}))

export const GitHubCIFilterJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(GitHubCIFilterSchema)

type GitHubCIFilter = z.infer<typeof GitHubCIFilterSchema>

async function resolveTarget(filter: GitHubCIFilter): Promise<ResolvedCITarget | null> {
  let ref = filter.sha
  let prTitle: string | null = null
  let baseBranch: string | null = null
  let currentHeadSha: string | null = null
  let prState: 'open' | 'closed' | null = null
  let merged = false
  if (filter.checkRunId) {
    const checkRun = await fetchCheckRun(filter.owner, filter.repo, filter.checkRunId)
    if (!checkRun) {
      return null
    }
    ref = checkRun.head_sha ?? filter.sha
  }
  if (filter.pr) {
    const prData = await fetchPullRequest(filter.owner, filter.repo, filter.pr)
    if (!prData) {
      return null
    }
    ref = filter.headSha ?? prData.head.sha
    prTitle = prData.title
    baseBranch = prData.base.ref
    currentHeadSha = prData.head.sha
    prState = prData.state
    merged = prData.merged
  }

  if (!ref && !filter.checkRunId) {
    return null
  }

  return {
    owner: filter.owner,
    repo: filter.repo,
    prNumber: filter.pr ?? null,
    prTitle,
    ref: ref ?? '',
    baseBranch,
    checkRunId: filter.checkRunId ?? null,
    currentHeadSha,
    prState,
    merged,
  }
}

function buildTerminalResult(awaitId: string, target: ResolvedCITarget): CheckResult | null {
  if (!target.prNumber || !target.currentHeadSha) {
    return null
  }

  // headSha mismatch means the await is stale (new push happened).
  // Mark it superseded so the agent can re-register with the new head.
  if (target.currentHeadSha !== target.ref) {
    return {
      awaitId,
      matched: true,
      resumeText: `GitHub PR #${target.prNumber} head changed from ${target.ref} to ${target.currentHeadSha}.`,
      resumePayloadJson: JSON.stringify({
        kind: 'github-ci',
        repo: `${target.owner}/${target.repo}`,
        pr: target.prNumber,
        ref: target.ref,
        currentHeadSha: target.currentHeadSha,
        outcome: 'superseded',
      }),
    }
  }

  const outcome = target.merged
    ? 'merged'
    : target.prState === 'closed'
      ? 'closed'
      : null
  if (!outcome) {
    return null
  }

  const resumeText = outcome === 'merged'
    ? `GitHub PR #${target.prNumber} was merged before the CI await matched.`
    : `GitHub PR #${target.prNumber} was closed before the CI await matched.`

  return {
    awaitId,
    matched: true,
    resumeText,
    resumePayloadJson: JSON.stringify({
      kind: 'github-ci',
      repo: `${target.owner}/${target.repo}`,
      pr: target.prNumber,
      ref: target.ref,
      currentHeadSha: target.currentHeadSha,
      outcome,
    }),
  }
}

function buildMissingTargetMessage(filter: GitHubCIFilter): string {
  const target = filter.pr
    ? `PR #${filter.pr}`
    : filter.checkRunId
      ? `check run ${filter.checkRunId}`
      : `commit ${filter.sha}`
  return `GitHub CI target not found or inaccessible: ${filter.owner}/${filter.repo} ${target}.`
}

function aggregateCI(checkRuns: GitHubCheckRun[], statuses: GitHubCommitStatus[]): AggregatedCI {
  let pendingCount = 0
  let failureCount = 0

  for (const run of checkRuns) {
    if (run.status !== 'completed') {
      pendingCount++
      continue
    }
    if (!run.conclusion || !PASSING_CHECK_CONCLUSIONS.has(run.conclusion)) {
      failureCount++
    }
  }

  for (const status of statuses) {
    if (status.state === 'pending') {
      pendingCount++
    }
    else if (status.state !== 'success') {
      failureCount++
    }
  }

  const totalCount = checkRuns.length + statuses.length
  const allCompleted = totalCount > 0 && pendingCount === 0
  const allPassed = allCompleted && failureCount === 0

  return {
    checkRuns,
    statuses,
    totalCount,
    pendingCount,
    failureCount,
    allCompleted,
    allPassed,
  }
}

function aggregateWorkflowRuns(workflowRuns: GitHubWorkflowRun[]): AggregatedWorkflowRuns {
  let pendingCount = 0
  let failureCount = 0

  for (const run of workflowRuns) {
    if (run.status !== 'completed') {
      pendingCount++
      continue
    }
    if (!run.conclusion || !PASSING_CHECK_CONCLUSIONS.has(run.conclusion)) {
      failureCount++
    }
  }

  return { workflowRuns, pendingCount, failureCount }
}

async function fetchAggregatedWorkflowRuns(target: ResolvedCITarget): Promise<AggregatedWorkflowRuns | null> {
  if (target.checkRunId || !target.ref) {
    return { workflowRuns: [], pendingCount: 0, failureCount: 0 }
  }
  let response: Awaited<ReturnType<typeof fetchWorkflowRunsForHead>>
  try {
    response = await fetchWorkflowRunsForHead(target.owner, target.repo, target.ref)
  }
  catch (error) {
    if (isGitHubMissingTarget(error)) {
      return { workflowRuns: [], pendingCount: 0, failureCount: 0 }
    }
    throw error
  }
  return response ? aggregateWorkflowRuns(response.workflow_runs) : null
}

function filterBypassedCI(
  aggregate: AggregatedCI,
  perAwaitBypassed: string[],
  workspacePatterns: string[],
  requiredContexts: Set<string>,
): AggregatedCI {
  if (perAwaitBypassed.length === 0 && workspacePatterns.length === 0) {
    return aggregate
  }

  const perAwaitSet = new Set(perAwaitBypassed)
  const filteredRuns = aggregate.checkRuns.filter((run) => {
    if (requiredContexts.has(run.name)) {
      return true
    }
    return !perAwaitSet.has(run.name) && !matchesAnyBypassPattern(run.name, workspacePatterns)
  })
  const filteredStatuses = aggregate.statuses.filter((status) => {
    if (requiredContexts.has(status.context)) {
      return true
    }
    return !perAwaitSet.has(status.context) && !matchesAnyBypassPattern(status.context, workspacePatterns)
  })

  return aggregateCI(filteredRuns, filteredStatuses)
}

async function fetchAggregatedCI(target: ResolvedCITarget): Promise<AggregatedCI | null> {
  if (target.checkRunId) {
    const checkRun = await fetchCheckRun(target.owner, target.repo, target.checkRunId)
    if (!checkRun) {
      return null
    }
    return aggregateCI([checkRun], [])
  }

  const [checkRuns, combinedStatus] = await Promise.all([
    fetchCheckRuns(target.owner, target.repo, target.ref),
    fetchCombinedStatus(target.owner, target.repo, target.ref),
  ])
  if (!checkRuns || !combinedStatus) {
    return null
  }
  return aggregateCI(checkRuns.check_runs, combinedStatus.statuses)
}

function parseCheckRunId(url: string | null): number | null {
  if (!url) {
    return null
  }
  const match = url.match(CHECK_RUN_ID_PATTERN)
  return match ? Number.parseInt(match[1], 10) : null
}

function toLiveWorkflowStep(step: GitHubWorkflowJobStep): LiveWorkflowJobStep {
  return {
    name: step.name,
    status: step.status,
    conclusion: step.conclusion,
    number: step.number,
    startedAt: step.started_at,
    completedAt: step.completed_at,
  }
}

function toLiveWorkflowJob(job: GitHubWorkflowJob): LiveWorkflowJob {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    htmlUrl: job.html_url,
    checkRunId: parseCheckRunId(job.check_run_url),
    startedAt: job.started_at,
    completedAt: job.completed_at,
    runnerName: job.runner_name,
    labels: job.labels,
    steps: job.steps.map(toLiveWorkflowStep),
  }
}

function toLiveWorkflowRun(run: GitHubWorkflowRun, jobs: GitHubWorkflowJob[]): LiveWorkflowRun {
  return {
    id: run.id,
    name: run.name,
    displayTitle: run.display_title,
    runNumber: run.run_number,
    runAttempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    jobs: jobs.map(toLiveWorkflowJob),
  }
}

async function fetchWorkflowRuns(target: ResolvedCITarget): Promise<LiveWorkflowRun[]> {
  if (!target.ref) {
    return []
  }
  const runs = await fetchWorkflowRunsForHead(target.owner, target.repo, target.ref)
  if (!runs) {
    return []
  }

  const liveRuns: LiveWorkflowRun[] = []
  for (const run of runs.workflow_runs) {
    const jobs = await fetchWorkflowRunJobs(target.owner, target.repo, run.id)
    liveRuns.push(toLiveWorkflowRun(run, jobs?.jobs ?? []))
  }
  return liveRuns
}

function findWorkflowJob(run: GitHubCheckRun, workflowRuns: LiveWorkflowRun[]): LiveWorkflowJob | null {
  if (run.id) {
    for (const workflowRun of workflowRuns) {
      const matchedJob = workflowRun.jobs.find(job => job.checkRunId === run.id)
      if (matchedJob) {
        return matchedJob
      }
    }
  }

  for (const workflowRun of workflowRuns) {
    const matchedJob = workflowRun.jobs.find(job => job.name === run.name)
    if (matchedJob) {
      return matchedJob
    }
  }

  return null
}

function toLiveCheckRun(run: GitHubCheckRun, workflowRuns: LiveWorkflowRun[], requiredContexts: Set<string>): LiveCheckRun {
  const workflowJob = findWorkflowJob(run, workflowRuns)
  const workflowRun = workflowJob
    ? workflowRuns.find(candidate => candidate.jobs.some(job => job.id === workflowJob.id)) ?? null
    : null

  return {
    id: run.id ?? null,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    required: requiredContexts.has(run.name),
    htmlUrl: run.html_url ?? null,
    detailsUrl: run.details_url ?? null,
    workflowRunId: workflowRun?.id ?? null,
    workflowJobId: workflowJob?.id ?? null,
    steps: workflowJob?.steps ?? [],
  }
}

function buildCIResumePayload(target: ResolvedCITarget, aggregate: AggregatedCI, noCIConfigured = false): string {
  return JSON.stringify({
    kind: 'github-ci',
    repo: `${target.owner}/${target.repo}`,
    pr: target.prNumber,
    ref: target.ref,
    checkRunId: target.checkRunId,
    allSuccess: aggregate.allPassed,
    totalCount: aggregate.totalCount,
    pendingCount: aggregate.pendingCount,
    failureCount: aggregate.failureCount,
    noCIConfigured,
    checkRuns: aggregate.checkRuns.map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
    statuses: aggregate.statuses.map(s => ({ context: s.context, state: s.state, description: s.description, targetUrl: s.target_url })),
  })
}

function buildSummary(aggregate: AggregatedCI): string {
  const failedChecks = aggregate.checkRuns
    .filter(r => r.status === 'completed' && (!r.conclusion || FAILING_CHECK_CONCLUSIONS.has(r.conclusion) || !PASSING_CHECK_CONCLUSIONS.has(r.conclusion)))
    .map(r => `${r.name}: ${r.conclusion ?? 'unknown'}`)
  const failedStatuses = aggregate.statuses
    .filter(s => s.state === 'error' || s.state === 'failure')
    .map(s => `${s.context}: ${s.state}`)
  return [...failedChecks, ...failedStatuses].join(', ')
}

export const githubCISource: SessionAwaitSource = {
  source: 'github-ci',
  pollIntervalMs: 30_000,

  async checkPending(awaits: SessionAwait[]): Promise<CheckResult[]> {
    if (isGitHubRateLimited()) {
      return awaits.map(a => ({ awaitId: a.id, matched: false, transientError: 'GitHub API rate limited' }))
    }

    const results: CheckResult[] = []

    for (const row of awaits) {
      const filter = GitHubCIFilterJsonSchema.parse(row.filterJson)
      const perAwaitBypassed = row.bypassedChecksJson ? JSON.parse(row.bypassedChecksJson) as string[] : []

      let target: ResolvedCITarget | null
      try {
        target = await resolveTarget(filter)
      }
      catch (err) {
        if (isGitHubMissingTarget(err)) {
          results.push({ awaitId: row.id, matched: false, permanentError: buildMissingTargetMessage(filter) })
          continue
        }
        results.push({ awaitId: row.id, matched: false, transientError: 'Unable to resolve GitHub CI target' })
        continue
      }
      if (!target) {
        results.push({ awaitId: row.id, matched: false, transientError: 'Unable to resolve GitHub CI target' })
        continue
      }

      const terminalResult = buildTerminalResult(row.id, target)
      if (terminalResult) {
        results.push(terminalResult)
        continue
      }

      let aggregate: AggregatedCI | null
      let workflowAggregate: AggregatedWorkflowRuns | null
      try {
        ;[aggregate, workflowAggregate] = await Promise.all([
          fetchAggregatedCI(target),
          fetchAggregatedWorkflowRuns(target),
        ])
      }
      catch (err) {
        if (isGitHubMissingTarget(err)) {
          results.push({ awaitId: row.id, matched: false, permanentError: buildMissingTargetMessage(filter) })
          continue
        }
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub CI API unavailable' })
        continue
      }
      if (!aggregate) {
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub CI API unavailable' })
        continue
      }
      if (!workflowAggregate) {
        results.push({ awaitId: row.id, matched: false, transientError: 'GitHub Actions API unavailable' })
        continue
      }

      if (workflowAggregate.pendingCount) {
        results.push({ awaitId: row.id, matched: false })
        continue
      }

      const workspacePatterns = getMatchingBypassPatterns(row.workspaceId, `${target.owner}/${target.repo}`)
      const requiredContexts = target.baseBranch
        ? (await fetchBranchProtection(target.owner, target.repo, target.baseBranch))?.requiredContexts ?? []
        : []
      aggregate = filterBypassedCI(aggregate, perAwaitBypassed, workspacePatterns, new Set(requiredContexts))

      if (aggregate.totalCount === 0) {
        const graceSeconds = filter.allowNoChecksAfterSeconds
        const ageSeconds = Math.floor(Date.now() / 1000) - row.createdAt
        if (ageSeconds > graceSeconds) {
          results.push({
            awaitId: row.id,
            matched: true,
            resumeText: 'No GitHub checks or commit statuses were found. Proceeding without CI signals.',
            resumePayloadJson: buildCIResumePayload(target, aggregate, true),
          })
        }
        else {
          results.push({ awaitId: row.id, matched: false })
        }
        continue
      }

      if (!aggregate.allCompleted) {
        results.push({ awaitId: row.id, matched: false })
        continue
      }

      results.push({
        awaitId: row.id,
        matched: true,
        resumeText: aggregate.allPassed && !workflowAggregate.failureCount
          ? `GitHub checks passed. All ${aggregate.totalCount} checks/statuses succeeded.`
          : `GitHub checks completed with failures. ${[
              buildSummary(aggregate),
              ...workflowAggregate.workflowRuns
                .filter(run => run.status === 'completed' && (!run.conclusion || !PASSING_CHECK_CONCLUSIONS.has(run.conclusion)))
                .map(run => `${run.name ?? `Workflow ${run.id}`}: ${run.conclusion ?? 'unknown'}`),
            ].filter(Boolean).join(', ')}`,
        resumePayloadJson: JSON.stringify({
          ...JSON.parse(buildCIResumePayload(target, aggregate)),
          allSuccess: aggregate.allPassed && !workflowAggregate.failureCount,
          workflowFailureCount: workflowAggregate.failureCount,
          workflowRuns: workflowAggregate.workflowRuns.map(run => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
          })),
        }),
      })
    }

    return results
  },
}

export async function validateGitHubCITarget(filterJson: string): Promise<void> {
  const filter = GitHubCIFilterJsonSchema.parse(filterJson)
  let target: ResolvedCITarget | null
  try {
    target = await resolveTarget(filter)
    const aggregate = target ? await fetchAggregatedCI(target) : null
    if (!target || !aggregate) {
      throw new GitHubTargetValidationError({
        category: 'unavailable',
        message: 'Unable to validate GitHub CI target right now.',
      })
    }
  }
  catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new GitHubTargetValidationError({
        category: 'invalid',
        message: buildMissingTargetMessage(filter),
      })
    }
    throw err
  }
}

export async function fetchLiveCIStatus(filterJson: string): Promise<LiveCIStatus | null> {
  const filter = GitHubCIFilterJsonSchema.parse(filterJson)

  if (!hasGitHubToken()) {
    return {
      kind: 'github-ci',
      owner: filter.owner,
      repo: filter.repo,
      prNumber: filter.pr ?? null,
      prTitle: null,
      ref: filter.statusRef,
      checkRuns: [],
      workflowRuns: [],
      statuses: [],
      totalCount: 0,
      pendingCount: 0,
      failureCount: 0,
      allCompleted: false,
      allPassed: false,
      noCIConfigured: false,
      hasToken: false,
    }
  }

  let target: ResolvedCITarget | null
  try {
    target = await resolveTarget(filter)
  }
  catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new GitHubTargetValidationError({
        category: 'invalid',
        message: buildMissingTargetMessage(filter),
      })
    }
    throw err
  }
  if (!target) {
    return null
  }

  let aggregate: AggregatedCI | null
  try {
    aggregate = await fetchAggregatedCI(target)
  }
  catch (err) {
    if (isGitHubMissingTarget(err)) {
      throw new GitHubTargetValidationError({
        category: 'invalid',
        message: buildMissingTargetMessage(filter),
      })
    }
    throw err
  }
  if (!aggregate) {
    return {
      kind: 'github-ci',
      owner: target.owner,
      repo: target.repo,
      prNumber: target.prNumber,
      prTitle: target.prTitle,
      ref: target.ref,
      checkRuns: [],
      workflowRuns: [],
      statuses: [],
      totalCount: 0,
      pendingCount: 0,
      failureCount: 0,
      allCompleted: false,
      allPassed: false,
      noCIConfigured: false,
      hasToken: true,
    }
  }

  const workflowRuns = await fetchWorkflowRuns(target)
  const workflowPending = workflowRuns.some(run => run.status !== 'completed')
  const workflowFailure = workflowRuns.some(run =>
    run.status === 'completed' && (!run.conclusion || !PASSING_CHECK_CONCLUSIONS.has(run.conclusion)))

  const requiredContexts = target.baseBranch
    ? (await fetchBranchProtection(target.owner, target.repo, target.baseBranch))?.requiredContexts ?? []
    : []
  const requiredSet = new Set(requiredContexts)

  return {
    kind: 'github-ci',
    owner: target.owner,
    repo: target.repo,
    prNumber: target.prNumber,
    prTitle: target.prTitle,
    ref: target.ref,
    checkRuns: aggregate.checkRuns.map(r => toLiveCheckRun(r, workflowRuns, requiredSet)),
    workflowRuns,
    statuses: aggregate.statuses.map(s => ({
      context: s.context,
      state: s.state,
      description: s.description,
      targetUrl: s.target_url,
    })),
    totalCount: aggregate.totalCount,
    pendingCount: Math.max(aggregate.pendingCount, workflowPending ? 1 : 0),
    failureCount: Math.max(aggregate.failureCount, workflowFailure ? 1 : 0),
    allCompleted: aggregate.allCompleted && !workflowPending,
    allPassed: aggregate.allPassed && !workflowPending && !workflowFailure,
    noCIConfigured: aggregate.totalCount === 0 && workflowRuns.length === 0,
    hasToken: true,
  }
}
