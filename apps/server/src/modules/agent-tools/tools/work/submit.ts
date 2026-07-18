import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { AgentToolHttpRequestError, requestAgentToolJson } from '../../http-client'
import type { AgentToolRegistration } from '../../registry'

export const WORK_SUBMIT_TOOL_NAME = 'work_submit'
export const WORK_SUBMIT_TOOL_DESCRIPTION = [
  'REQUIRED FINALIZATION TOOL FOR CRADLE WORK.',
  'You MUST call this tool before claiming that a Cradle Work task is complete or ending a turn in which you made delivery-related code or commit changes.',
  'Call it only after the requested implementation is finished (or an intermediate revision is ready), relevant verification has run, all intended changes are committed locally, and the managed Worktree checkout is clean.',
  'This tool validates local readiness, records the handoff title/summary/test plan, pushes the Work branch, and creates or updates the Draft pull request — the Cradle equivalent of closed-loop cloud delivery.',
  'If the tool returns an error, you MUST NOT claim completion. Fix the reported readiness problem and call this tool again, or clearly report the blocker to the user.',
  'It does NOT mark the PR ready, merge, or close the PR. Use cradle CLI / gh for inspection; mark-ready only when the user explicitly asks.',
].join(' ')

const WorkSubmitResponseSchema = z.object({
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

export interface WorkSubmitToolInput {
  workId: string
  title: string
  summary: string
  testPlan: string
  base?: string
}

export async function executeWorkSubmitTool({
  workId,
  title,
  summary,
  testPlan,
  base,
}: WorkSubmitToolInput) {
  try {
    const body: Record<string, string> = { title, summary, testPlan }
    if (base?.trim()) {
      body.base = base.trim()
    }
    const response = await requestAgentToolJson({
      path: `/works/${encodeURIComponent(workId)}/submit`,
      body,
      responseSchema: WorkSubmitResponseSchema,
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
          `Work ${response.work.id} submitted.`,
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
          ? `Work submit failed (${normalized.code ?? 'request_failed'}): ${normalized.message}. Do not claim completion; resolve this readiness/delivery problem and call work_submit again, or report the blocker.`
          : `Work submit failed: ${normalized.message}. Do not claim completion; resolve the problem and call work_submit again, or report the blocker.`,
      }],
      isError: true,
    }
  }
}

function registerWorkSubmitTool(server: McpServer): void {
  server.registerTool(
    WORK_SUBMIT_TOOL_NAME,
    {
      title: 'Submit Cradle Work (Draft PR)',
      description: WORK_SUBMIT_TOOL_DESCRIPTION,
      inputSchema: {
        workId: z.string().min(1).describe('The active Cradle Work ID supplied in the Work runtime context.'),
        title: z.string().min(1).describe('A concise review title describing the completed local Work / PR title.'),
        summary: z.string().min(1).describe('A concrete summary of what changed and why.'),
        testPlan: z.string().min(1).describe('The verification already performed and any remaining reviewer checks.'),
        base: z.string().min(1).optional().describe('Optional PR base branch. Omit to use the preferred base for this Work.'),
      },
    },
    executeWorkSubmitTool,
  )
}

export const workSubmitTool: AgentToolRegistration = {
  name: WORK_SUBMIT_TOOL_NAME,
  register: registerWorkSubmitTool,
}
