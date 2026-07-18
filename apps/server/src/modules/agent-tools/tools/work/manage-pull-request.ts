import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { AgentToolHttpRequestError, requestAgentToolJson } from '../../http-client'
import type { AgentToolRegistration } from '../../registry'

export const MANAGE_PULL_REQUEST_TOOL_NAME = 'manage_pull_request'
export const MANAGE_PULL_REQUEST_TOOL_DESCRIPTION = [
  'REQUIRED PULL REQUEST DELIVERY TOOL FOR CRADLE WORK.',
  'You MUST call this tool with action "create_or_update_draft" before claiming that a task is complete or ending a turn in which you made delivery-related code or commit changes.',
  'Call "create_or_update_draft" only after the requested implementation is finished (or an intermediate revision is ready), relevant verification has run, all intended changes are committed locally, and the managed checkout is clean. It validates local readiness, records the handoff title/summary/test plan, pushes the branch, and creates or updates the Draft pull request — the Cradle equivalent of closed-loop cloud delivery.',
  'Call "rename_branch" early, once the objective is clear and before the first pull request exists, to give the Cradle-managed branch a meaningful name (keeping the cradle/wt/ prefix). Once a pull request exists the branch name is fixed.',
  'If the tool returns an error, you MUST NOT claim completion. Fix the reported problem and call this tool again, or clearly report the blocker to the user.',
  'It does NOT mark the PR ready, merge, or close the PR. Use cradle CLI / gh for inspection; mark-ready only when the user explicitly asks.',
].join(' ')

const ManagePullRequestResponseSchema = z.object({
  work: z.object({
    id: z.string(),
    preparedAt: z.number().nullable().optional(),
    lastSubmittedAt: z.number().nullable().optional(),
    handoffTitle: z.string().nullable().optional(),
  }),
  readiness: z.object({
    clean: z.boolean().optional(),
    commitsAhead: z.number().optional(),
  }).optional(),
  execution: z.object({
    worktreeBranch: z.string().nullable().optional(),
  }).passthrough().optional(),
  pullRequest: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number(),
    url: z.string().optional(),
    title: z.string().optional(),
    isDraft: z.boolean().optional(),
    state: z.string().optional(),
    headRef: z.string().optional(),
    headSha: z.string().nullable().optional(),
  }).nullable().optional(),
}).passthrough()

export interface ManagePullRequestToolInput {
  workId: string
  action: 'create_or_update_draft' | 'rename_branch'
  title?: string
  summary?: string
  testPlan?: string
  base?: string
  branchName?: string
}

function missingFieldError(field: string, action: ManagePullRequestToolInput['action']) {
  return {
    content: [{
      type: 'text' as const,
      text: `manage_pull_request (${action}) requires "${field}". Provide it and call the tool again; no request was made.`,
    }],
    isError: true,
  }
}

async function executeCreateOrUpdateDraft({ workId, title, summary, testPlan, base }: ManagePullRequestToolInput) {
  if (!title?.trim()) {
    return missingFieldError('title', 'create_or_update_draft')
  }
  if (!summary?.trim()) {
    return missingFieldError('summary', 'create_or_update_draft')
  }
  if (!testPlan?.trim()) {
    return missingFieldError('testPlan', 'create_or_update_draft')
  }

  try {
    const body: Record<string, string> = { title: title.trim(), summary: summary.trim(), testPlan: testPlan.trim() }
    if (base?.trim()) {
      body.base = base.trim()
    }
    const response = await requestAgentToolJson({
      path: `/works/${encodeURIComponent(workId)}/submit`,
      body,
      responseSchema: ManagePullRequestResponseSchema,
    })
    const pr = response.pullRequest
    const prLine = pr
      ? `Draft PR: ${pr.url ?? `${pr.owner}/${pr.repo}#${pr.number}`}${pr.headRef ? ` (head ${pr.headRef})` : ''}.`
      : 'Submit succeeded but no pull request view was returned; inspect with `cradle work get` or `cradle session pull-request get`.'
    const readiness = response.readiness
    const readinessLine = readiness
      ? ` Local readiness: clean=${String(readiness.clean ?? 'unknown')}, commitsAhead=${String(readiness.commitsAhead ?? 'unknown')}.`
      : ''

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Draft PR created/updated for Work ${response.work.id}.`,
          prLine,
          readinessLine.trim(),
          'Closed-loop delivery complete for this revision. Do not merge or mark ready unless the user explicitly asks.',
          'Inspect CI/PR with `cradle work get`, `cradle session pull-request get`, `cradle session await-summary`, or `gh` as needed.',
        ].filter(Boolean).join(' '),
      }],
      structuredContent: {
        workId: response.work.id,
        submitted: true,
        preparedAt: response.work.preparedAt ?? null,
        lastSubmittedAt: response.work.lastSubmittedAt ?? null,
        clean: readiness?.clean ?? null,
        commitsAhead: readiness?.commitsAhead ?? null,
        pullRequest: pr
          ? {
              owner: pr.owner,
              repo: pr.repo,
              number: pr.number,
              url: pr.url ?? null,
              headRef: pr.headRef ?? null,
              headSha: pr.headSha ?? null,
            }
          : null,
      },
    }
  }
  catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    return {
      content: [{
        type: 'text' as const,
        text: normalized instanceof AgentToolHttpRequestError
          ? `Create/update Draft PR failed (${normalized.code ?? 'request_failed'}): ${normalized.message}. Do not claim completion; resolve this readiness/delivery problem and call manage_pull_request again, or report the blocker.`
          : `Create/update Draft PR failed: ${normalized.message}. Do not claim completion; resolve the problem and call manage_pull_request again, or report the blocker.`,
      }],
      isError: true,
    }
  }
}

async function executeRenameBranch({ workId, branchName }: ManagePullRequestToolInput) {
  if (!branchName?.trim()) {
    return missingFieldError('branchName', 'rename_branch')
  }

  try {
    const response = await requestAgentToolJson({
      path: `/works/${encodeURIComponent(workId)}/branch`,
      body: { branch: branchName.trim() },
      responseSchema: ManagePullRequestResponseSchema,
    })
    const branch = response.execution?.worktreeBranch ?? branchName.trim()

    return {
      content: [{
        type: 'text' as const,
        text: [
          `Branch renamed to ${branch} for Work ${response.work.id}.`,
          'The branch can no longer be renamed once a pull request exists.',
          'Continue implementation on the managed branch, then call manage_pull_request with action "create_or_update_draft" to deliver.',
        ].join(' '),
      }],
      structuredContent: {
        workId: response.work.id,
        branch,
      },
    }
  }
  catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    return {
      content: [{
        type: 'text' as const,
        text: normalized instanceof AgentToolHttpRequestError
          ? `Branch rename failed (${normalized.code ?? 'request_failed'}): ${normalized.message}. Do not claim completion; resolve the problem and call manage_pull_request again, or report the blocker.`
          : `Branch rename failed: ${normalized.message}. Do not claim completion; resolve the problem and call manage_pull_request again, or report the blocker.`,
      }],
      isError: true,
    }
  }
}

export async function executeManagePullRequestTool(input: ManagePullRequestToolInput) {
  return input.action === 'rename_branch'
    ? await executeRenameBranch(input)
    : await executeCreateOrUpdateDraft(input)
}

function registerManagePullRequestTool(server: McpServer): void {
  server.registerTool(
    MANAGE_PULL_REQUEST_TOOL_NAME,
    {
      title: 'Manage Pull Request (Cradle Work delivery)',
      description: MANAGE_PULL_REQUEST_TOOL_DESCRIPTION,
      inputSchema: {
        workId: z.string().min(1).describe('The active Cradle Work ID supplied in the Work runtime context.'),
        action: z.enum(['create_or_update_draft', 'rename_branch']),
        title: z.string().min(1).optional().describe('PR title. Required for create_or_update_draft.'),
        summary: z.string().min(1).optional().describe('What changed and why. Required for create_or_update_draft.'),
        testPlan: z.string().min(1).optional().describe('Verification performed. Required for create_or_update_draft.'),
        base: z.string().min(1).optional().describe('Optional PR base branch.'),
        branchName: z.string().min(1).optional().describe('New branch name with the cradle/wt/ prefix. Required for rename_branch.'),
      },
    },
    executeManagePullRequestTool,
  )
}

export const managePullRequestTool: AgentToolRegistration = {
  name: MANAGE_PULL_REQUEST_TOOL_NAME,
  register: registerManagePullRequestTool,
}
