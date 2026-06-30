import { agentSessions, issues } from '@cradle/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import type { SessionAwaitSource } from '../types'

export const CRADLE_ISSUE_AGENT_AWAIT_SOURCE = 'cradle-issue-agent'

const TerminalAgentSessionStatusSchema = z.enum(['completed', 'failed', 'stopped'])

const CradleIssueAgentInputFilterSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1),
  mode: z.literal('all-current-delegations').default('all-current-delegations'),
})

const CradleIssueAgentStoredFilterSchema = z.object({
  mode: z.literal('all-current-delegations'),
  issues: z.array(z.object({
    issueId: z.string(),
    agentSessionId: z.string(),
  })).min(1),
})

type CradleIssueAgentStoredFilter = z.infer<typeof CradleIssueAgentStoredFilterSchema>

interface AgentIssueResult {
  issueId: string
  issueTitle: string
  issueNumber: number
  agentSessionId: string
  chatSessionId: string | null
  status: z.infer<typeof TerminalAgentSessionStatusSchema>
}

function parseJson<T>(schema: z.ZodType<T>, filterJson: string): T {
  return schema.parse(JSON.parse(filterJson))
}

function formatIssueLabel(issue: { id: string, number: number, title: string }): string {
  return `${issue.id} (${issue.title || `Issue ${issue.number}`})`
}

function readIssueRows(workspaceId: string, issueIds: string[]) {
  const rows = db()
    .select()
    .from(issues)
    .where(and(
      eq(issues.workspaceId, workspaceId),
      inArray(issues.id, issueIds),
    ))
    .all()
  return new Map(rows.map(row => [row.id, row]))
}

function requireCurrentDelegationSession(issue: {
  id: string
  delegateAgentId: string | null
  delegateProviderTargetId: string | null
}) {
  if (!issue.delegateAgentId || !issue.delegateProviderTargetId) {
    throw new AppError({
      code: 'cradle_issue_agent_await_target_invalid',
      status: 400,
      message: 'Issue does not have a current agent delegation.',
      details: { issueId: issue.id },
    })
  }

  const session = db()
    .select()
    .from(agentSessions)
    .where(and(
      eq(agentSessions.issueId, issue.id),
      eq(agentSessions.agentId, issue.delegateAgentId),
      eq(agentSessions.providerTargetId, issue.delegateProviderTargetId),
    ))
    .orderBy(desc(agentSessions.createdAt))
    .get()

  if (!session) {
    throw new AppError({
      code: 'cradle_issue_agent_await_target_invalid',
      status: 400,
      message: 'Issue delegation does not have an agent session to await.',
      details: { issueId: issue.id },
    })
  }

  return session
}

export function normalizeCradleIssueAgentAwaitFilter(input: {
  workspaceId: string
  filterJson: string
}): string {
  const filter = parseJson(CradleIssueAgentInputFilterSchema, input.filterJson)
  const issueRows = readIssueRows(input.workspaceId, filter.issueIds)
  const resolved = filter.issueIds.map((issueId) => {
    const issue = issueRows.get(issueId)
    if (!issue) {
      throw new AppError({
        code: 'cradle_issue_agent_await_target_invalid',
        status: 400,
        message: 'Issue not found in await workspace.',
        details: { workspaceId: input.workspaceId, issueId },
      })
    }
    const session = requireCurrentDelegationSession(issue)
    return {
      issueId,
      agentSessionId: session.id,
    }
  })

  return JSON.stringify({
    mode: filter.mode,
    issues: resolved,
  } satisfies CradleIssueAgentStoredFilter)
}

function buildResumePayload(results: AgentIssueResult[]): string {
  return JSON.stringify({
    source: CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
    mode: 'all-current-delegations',
    results: results.map(result => ({
      issueId: result.issueId,
      issueTitle: result.issueTitle,
      issueNumber: result.issueNumber,
      agentSessionId: result.agentSessionId,
      chatSessionId: result.chatSessionId,
      status: result.status,
    })),
  })
}

function buildResumeText(results: AgentIssueResult[]): string {
  const lines = [
    'Cradle issue agent work finished.',
    '',
    ...results.map(result => `- ${formatIssueLabel({
      id: result.issueId,
      number: result.issueNumber,
      title: result.issueTitle,
    })}: ${result.status}`),
    '',
    'Review the issue comments, linked sessions, and agent activities, then synthesize the next step.',
  ]
  return lines.join('\n')
}

function readTerminalResults(filter: CradleIssueAgentStoredFilter): {
  matched: false
  permanentError?: string
} | {
  matched: true
  results: AgentIssueResult[]
} {
  const issueIds = filter.issues.map(item => item.issueId)
  const sessionIds = filter.issues.map(item => item.agentSessionId)
  const issueRows = db()
    .select()
    .from(issues)
    .where(inArray(issues.id, issueIds))
    .all()
  const sessionRows = db()
    .select()
    .from(agentSessions)
    .where(inArray(agentSessions.id, sessionIds))
    .all()
  const issueById = new Map(issueRows.map(issue => [issue.id, issue]))
  const sessionById = new Map(sessionRows.map(session => [session.id, session]))

  const results: AgentIssueResult[] = []
  for (const target of filter.issues) {
    const issue = issueById.get(target.issueId)
    if (!issue) {
      return {
        matched: false,
        permanentError: `Cradle issue await target no longer exists: ${target.issueId}`,
      }
    }

    const session = sessionById.get(target.agentSessionId)
    if (!session) {
      return {
        matched: false,
        permanentError: `Cradle issue agent session await target no longer exists: ${target.agentSessionId}`,
      }
    }

    const terminalStatus = TerminalAgentSessionStatusSchema.safeParse(session.status)
    if (!terminalStatus.success) {
      return { matched: false }
    }

    results.push({
      issueId: issue.id,
      issueTitle: issue.title,
      issueNumber: issue.number,
      agentSessionId: session.id,
      chatSessionId: session.chatSessionId,
      status: terminalStatus.data,
    })
  }

  return { matched: true, results }
}

export const cradleIssueAgentSource: SessionAwaitSource = {
  source: CRADLE_ISSUE_AGENT_AWAIT_SOURCE,
  async checkPending(awaits) {
    return awaits.map((row) => {
      const filter = parseJson(CradleIssueAgentStoredFilterSchema, row.filterJson)
      const result = readTerminalResults(filter)
      if (!result.matched) {
        return {
          awaitId: row.id,
          matched: false,
          permanentError: result.permanentError,
        }
      }
      return {
        awaitId: row.id,
        matched: true,
        resumeText: buildResumeText(result.results),
        resumePayloadJson: buildResumePayload(result.results),
      }
    })
  },
}
