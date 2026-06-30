import { issues, issueStatuses } from '@cradle/db'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import * as Issue from '../../issue/service'
import type { SessionAwaitSource } from '../types'

export const CRADLE_ISSUE_STATUS_AWAIT_SOURCE = 'cradle-issue-status'

const IssueStatusCategorySchema = z.enum([
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
])

const IssueStatusAwaitModeSchema = z.enum(['all', 'any'])

const CradleIssueStatusInputFilterSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1),
  mode: IssueStatusAwaitModeSchema.default('all'),
  categories: z.array(IssueStatusCategorySchema).min(1).optional(),
  statusIds: z.array(z.string().min(1)).min(1).optional(),
  statusNames: z.array(z.string().min(1)).min(1).optional(),
}).superRefine((value, context) => {
  const targetCount = [value.categories, value.statusIds, value.statusNames]
    .filter(target => target !== undefined)
    .length
  if (targetCount !== 1) {
    context.addIssue({
      code: 'custom',
      message: 'Pass exactly one issue status await target: categories, statusIds, or statusNames.',
      path: ['categories'],
    })
  }
})

const CradleIssueStatusStoredFilterSchema = z.object({
  issueIds: z.array(z.string().min(1)).min(1),
  mode: IssueStatusAwaitModeSchema,
  categories: z.array(IssueStatusCategorySchema).min(1).optional(),
  statusIds: z.array(z.string().min(1)).min(1).optional(),
}).superRefine((value, context) => {
  const targetCount = [value.categories, value.statusIds]
    .filter(target => target !== undefined)
    .length
  if (targetCount !== 1) {
    context.addIssue({
      code: 'custom',
      message: 'Stored issue status await filters require exactly one target: categories or statusIds.',
      path: ['categories'],
    })
  }
})

type CradleIssueStatusStoredFilter = z.infer<typeof CradleIssueStatusStoredFilterSchema>

interface IssueStatusResult {
  issueId: string
  issueTitle: string
  issueNumber: number
  statusId: string | null
  statusName: string | null
  category: z.infer<typeof IssueStatusCategorySchema> | null
  matched: boolean
}

function parseJson<T>(schema: z.ZodType<T>, filterJson: string): T {
  return schema.parse(JSON.parse(filterJson))
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

function requireIssueTargets(workspaceId: string, issueIds: string[]): void {
  const issueRows = readIssueRows(workspaceId, issueIds)
  for (const issueId of issueIds) {
    if (!issueRows.has(issueId)) {
      throw new AppError({
        code: 'cradle_issue_status_await_target_invalid',
        status: 400,
        message: 'Issue not found in await workspace.',
        details: { workspaceId, issueId },
      })
    }
  }
}

function requireStatusTargets(workspaceId: string, statusIds: string[]): void {
  const rows = db()
    .select()
    .from(issueStatuses)
    .where(and(
      eq(issueStatuses.workspaceId, workspaceId),
      inArray(issueStatuses.id, statusIds),
    ))
    .all()
  const statusById = new Map(rows.map(row => [row.id, row]))
  for (const statusId of statusIds) {
    if (!statusById.has(statusId)) {
      throw new AppError({
        code: 'cradle_issue_status_await_target_invalid',
        status: 400,
        message: 'Issue status not found in await workspace.',
        details: { workspaceId, statusId },
      })
    }
  }
}

export function normalizeCradleIssueStatusAwaitFilter(input: {
  workspaceId: string
  filterJson: string
}): string {
  const filter = parseJson(CradleIssueStatusInputFilterSchema, input.filterJson)
  requireIssueTargets(input.workspaceId, filter.issueIds)

  if (filter.statusNames) {
    const statuses = Issue.resolveStatusNames(input.workspaceId, filter.statusNames)
    return JSON.stringify({
      issueIds: filter.issueIds,
      mode: filter.mode,
      statusIds: statuses.map(status => status.id),
    } satisfies CradleIssueStatusStoredFilter)
  }

  if (filter.statusIds) {
    requireStatusTargets(input.workspaceId, filter.statusIds)
    return JSON.stringify({
      issueIds: filter.issueIds,
      mode: filter.mode,
      statusIds: filter.statusIds,
    } satisfies CradleIssueStatusStoredFilter)
  }

  const categories = filter.categories
  if (!categories) {
    throw new AppError({
      code: 'cradle_issue_status_await_target_invalid',
      status: 400,
      message: 'Issue status await requires a target condition.',
      details: { workspaceId: input.workspaceId },
    })
  }

  return JSON.stringify({
    issueIds: filter.issueIds,
    mode: filter.mode,
    categories,
  } satisfies CradleIssueStatusStoredFilter)
}

function readIssueStatusResults(filter: CradleIssueStatusStoredFilter): {
  results: IssueStatusResult[]
  permanentError?: string
} {
  const rows = db()
    .select({
      issueId: issues.id,
      issueTitle: issues.title,
      issueNumber: issues.number,
      statusId: issues.statusId,
      statusName: issueStatuses.name,
      category: issueStatuses.category,
    })
    .from(issues)
    .leftJoin(issueStatuses, eq(issues.statusId, issueStatuses.id))
    .where(inArray(issues.id, filter.issueIds))
    .all()
  const resultByIssueId = new Map(rows.map((row) => {
    const category = row.category === null ? null : IssueStatusCategorySchema.parse(row.category)
    const matched = filter.categories
      ? category !== null && filter.categories.includes(category)
      : row.statusId !== null && filter.statusIds?.includes(row.statusId) === true
    return [row.issueId, {
      issueId: row.issueId,
      issueTitle: row.issueTitle,
      issueNumber: row.issueNumber,
      statusId: row.statusId,
      statusName: row.statusName,
      category,
      matched,
    } satisfies IssueStatusResult]
  }))

  const results: IssueStatusResult[] = []
  for (const issueId of filter.issueIds) {
    const result = resultByIssueId.get(issueId)
    if (!result) {
      return {
        results,
        permanentError: `Cradle issue status await target no longer exists: ${issueId}`,
      }
    }
    results.push(result)
  }

  return { results }
}

function hasMatched(filter: CradleIssueStatusStoredFilter, results: IssueStatusResult[]): boolean {
  if (filter.mode === 'any') {
    return results.some(result => result.matched)
  }
  return results.every(result => result.matched)
}

function buildResumePayload(filter: CradleIssueStatusStoredFilter, results: IssueStatusResult[]): string {
  return JSON.stringify({
    source: CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
    mode: filter.mode,
    results,
  })
}

function buildResumeText(filter: CradleIssueStatusStoredFilter, results: IssueStatusResult[]): string {
  const lines = [
    'Cradle issue status condition matched.',
    '',
    ...results.map(result => `- ${result.issueId} (${result.issueTitle || `Issue ${result.issueNumber}`}): ${result.statusName ?? 'No status'}${result.matched ? ' [matched]' : ''}`),
    '',
    `Mode: ${filter.mode}`,
  ]
  return lines.join('\n')
}

export const cradleIssueStatusSource: SessionAwaitSource = {
  source: CRADLE_ISSUE_STATUS_AWAIT_SOURCE,
  async checkPending(awaits) {
    return awaits.map((row) => {
      const filter = parseJson(CradleIssueStatusStoredFilterSchema, row.filterJson)
      const { results, permanentError } = readIssueStatusResults(filter)
      if (permanentError) {
        return {
          awaitId: row.id,
          matched: false,
          permanentError,
        }
      }
      if (!hasMatched(filter, results)) {
        return { awaitId: row.id, matched: false }
      }
      return {
        awaitId: row.id,
        matched: true,
        resumeText: buildResumeText(filter, results),
        resumePayloadJson: buildResumePayload(filter, results),
      }
    })
  },
}
