import { randomUUID } from 'node:crypto'

import type { Issue, IssueComment, IssueFieldChange, IssueMilestone, IssueRelation, IssueStatus, Workspace } from '@cradle/db'
import {
  agents,
  issueComments,
  issueFieldChanges,
  issueMilestones,
  issueRelations,
  issues,
  issueStatuses,
  providerTargets,
  sessions,
  workspaces,
} from '@cradle/db'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import type { MutationActor, MutationActorKind } from '../../http/actor-context'
import { db } from '../../infra'
import { readRuntimeIssueActorLabel } from '../provider-contracts/runtime-compatibility'
import * as Session from '../session/service'

type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
type IssueActorKind = Extract<MutationActorKind, 'user' | 'agent' | 'provider-target' | 'system'>
type IssueCommentAuthorKind = IssueActorKind | 'system.delegated' | 'system.undelegated'

const StatusCategorySchema = z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'])
const IssueCommentAuthorKindSchema = z.enum(['user', 'agent', 'provider-target', 'system', 'system.delegated', 'system.undelegated'])
const IssueLabelsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.string()))

const CreateIssueInputSchema = z.object({
  workspaceId: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
  labels: z.array(z.string()).default([]),
  milestoneId: z.string().nullable().default(null),
  parentIssueId: z.string().nullable().default(null),
  statusId: z.string().nullable().default(null),
  statusName: z.string().nullable().default(null),
  dueDate: z.number().nullable().default(null),
  assigneeKind: z.string().nullable().default(null),
  assigneeId: z.string().nullable().default(null),
})

const CreateStatusInputSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  color: z.string().nullable().default(null),
  category: StatusCategorySchema.default('unstarted'),
})

const CreateMilestoneInputSchema = z.object({
  workspaceId: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  dueDate: z.number().nullable().default(null),
  status: z.enum(['open', 'closed']).default('open'),
})

const AddCommentBaseInputSchema = z.object({
  issueId: z.string(),
  content: z.string(),
  authorKind: IssueCommentAuthorKindSchema.default('user'),
  authorId: z.string().nullable().optional(),
  sourceChatSessionId: z.string().nullable().optional(),
})

const AddCommentInputSchema = AddCommentBaseInputSchema.transform(input => ({
  ...input,
  authorId: z.string().nullable().default(() => input.authorKind.startsWith('system') ? null : '__self__').parse(input.authorId),
  sourceChatSessionId: input.sourceChatSessionId ?? null,
}))

type IssueMutationActor = { kind: IssueActorKind, id: string | null, sourceChatSessionId?: string | null }

export type IssueFieldChangeView = IssueFieldChange

export const IssueContextRefsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.string()))

export const IssuePromptContextRefsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.union([
    z.string().transform(value => ({
      type: 'ref',
      value,
      label: undefined as string | undefined,
    })),
    z.object({
      type: z.string(),
      value: z.string(),
      label: z.string().optional(),
    }),
  ])))

export interface IssueCommentAuthorView {
  kind: IssueActorKind
  id: string | null
  displayName: string
  avatarUrl: string | null
  label: string | null
}

export type IssueCommentView = IssueComment & { author: IssueCommentAuthorView }
export type IssueView = Omit<Issue, 'labels'> & { labels: string[] }

export type IssueActivityValueToken
  = | 'changed'
    | 'current-user'
    | 'empty'
    | 'no-due-date'
    | 'no-labels'
    | 'no-milestone'
    | 'no-parent'
    | 'no-status'
    | 'priority-high'
    | 'priority-low'
    | 'priority-medium'
    | 'priority-none'
    | 'priority-urgent'
    | 'unassigned'
    | 'unknown-issue'
    | 'unknown-milestone'
    | 'unknown-status'
    | 'unknown-user'

export type IssueActivityValueView
  = | { kind: 'date', timestamp: number }
    | { kind: 'text', text: string }
    | { kind: 'token', token: IssueActivityValueToken }

export type IssueActivityField
  = | 'assignee'
    | 'description'
    | 'due-date'
    | 'labels'
    | 'metadata'
    | 'milestone'
    | 'parent'
    | 'priority'
    | 'status'
    | 'title'
    | 'workspace'

export type IssueActivityAction
  = | 'added-description'
    | 'changed-field'
    | 'cleared-description'
    | 'renamed-issue'
    | 'updated-description'

export interface IssueActivityFieldChangeView {
  action: IssueActivityAction
  field: IssueActivityField | null
  fromValue: IssueActivityValueView | null
  toValue: IssueActivityValueView | null
}

export interface IssueActivityCommentView {
  content: string
  systemKind: 'delegated' | 'system' | 'undelegated' | null
}

export interface IssueActivityItemView {
  id: string
  issueId: string
  kind: 'comment' | 'created' | 'field-change'
  actor: IssueCommentAuthorView
  comment: IssueActivityCommentView | null
  fieldChange: IssueActivityFieldChangeView | null
  sourceChatSessionId: string | null
  createdAt: number
}

const DEFAULT_STATUSES = [
  { name: 'Backlog', color: '#6b7280', category: 'backlog' as const },
  { name: 'To Do', color: '#9ca3af', category: 'unstarted' as const },
  { name: 'In Progress', color: '#f59e0b', category: 'started' as const },
  { name: 'Done', color: '#22c55e', category: 'completed' as const },
  { name: 'Canceled', color: '#6b7280', category: 'canceled' as const },
] as const

function getWorkspace(workspaceId: string): Workspace | undefined {
  return db().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
}

function requireWorkspace(workspaceId: string): Workspace {
  const workspace = getWorkspace(workspaceId)
  if (!workspace) {
    throw new AppError({ code: 'issue_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
  return workspace
}

function countStatuses(workspaceId: string): number {
  const row = db().select({ count: sql<number>`count(*)` }).from(issueStatuses).where(eq(issueStatuses.workspaceId, workspaceId)).get()
  return row?.count ?? 0
}

function createStatusRow(input: { workspaceId: string, name: string, color: string | null, category: StatusCategory, order: number }): IssueStatus {
  return db().insert(issueStatuses).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    color: input.color,
    category: input.category,
    order: input.order,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

function normalizeStatusName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function readWorkspaceStatuses(workspaceId: string): IssueStatus[] {
  return db().select().from(issueStatuses).where(eq(issueStatuses.workspaceId, workspaceId)).orderBy(issueStatuses.order).all()
}

export function resolveStatusNames(workspaceId: string, statusNames: string[]): IssueStatus[] {
  requireWorkspace(workspaceId)
  seedDefaultStatuses(workspaceId)
  const statuses = readWorkspaceStatuses(workspaceId)
  return statusNames.map((statusName) => {
    const normalizedName = normalizeStatusName(statusName)
    if (!normalizedName) {
      throw new AppError({
        code: 'issue_status_name_empty',
        status: 400,
        message: 'Status name must not be empty',
        details: { workspaceId },
      })
    }
    const status = statuses.find(candidate => normalizeStatusName(candidate.name) === normalizedName)
    if (!status) {
      throw new AppError({
        code: 'issue_status_not_found',
        status: 404,
        message: 'Status not found',
        details: { workspaceId, statusName, normalizedStatusName: normalizedName },
      })
    }
    return status
  })
}

function resolveStatusId(workspaceId: string, reference: {
  statusId?: string | null
  statusName?: string | null
}, options: { useDefaultWhenMissing: boolean }): string | null {
  if (reference.statusId != null && reference.statusName != null) {
    throw new AppError({
      code: 'issue_status_reference_conflict',
      status: 400,
      message: 'Use either statusId or statusName, not both',
      details: { statusId: reference.statusId, statusName: reference.statusName },
    })
  }

  if (reference.statusId == null && reference.statusName == null && !options.useDefaultWhenMissing) {
    return null
  }

  seedDefaultStatuses(workspaceId)

  if (reference.statusId != null) {
    const status = db()
      .select({ id: issueStatuses.id })
      .from(issueStatuses)
      .where(sql`${issueStatuses.workspaceId} = ${workspaceId} AND ${issueStatuses.id} = ${reference.statusId}`)
      .get()
    if (!status) {
      throw new AppError({
        code: 'issue_status_not_found',
        status: 404,
        message: 'Status not found',
        details: { workspaceId, statusId: reference.statusId },
      })
    }
    return status.id
  }

  if (reference.statusName != null) {
    const normalizedName = normalizeStatusName(reference.statusName)
    if (!normalizedName) {
      throw new AppError({
        code: 'issue_status_name_empty',
        status: 400,
        message: 'Status name must not be empty',
        details: { workspaceId },
      })
    }
    const status = readWorkspaceStatuses(workspaceId)
      .find(candidate => normalizeStatusName(candidate.name) === normalizedName)
    if (!status) {
      throw new AppError({
        code: 'issue_status_not_found',
        status: 404,
        message: 'Status not found',
        details: { workspaceId, statusName: reference.statusName, normalizedStatusName: normalizedName },
      })
    }
    return status.id
  }

  if (!options.useDefaultWhenMissing) {
    return null
  }

  return readWorkspaceStatuses(workspaceId)[0]?.id ?? null
}

export function seedDefaultStatuses(workspaceId: string): void {
  requireWorkspace(workspaceId)
  if (countStatuses(workspaceId) > 0) {
    return
  }
  DEFAULT_STATUSES.forEach((status, order) => {
    createStatusRow({ workspaceId, name: status.name, color: status.color, category: status.category, order })
  })
}

function readIssuePrefix(workspace: Workspace): string {
  const raw = workspace.identifier || workspace.name || workspace.id
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return (normalized.slice(0, 3) || 'ISS').padEnd(3, 'X')
}

function formatIssueId(prefix: string, number: number): string {
  return `${prefix}-${number.toString().padStart(3, '0')}`
}

function nextIssueIdentity(workspace: Workspace): { id: string, number: number } {
  const prefix = readIssuePrefix(workspace)
  const maxNumberRow = db()
    .select({ maxNum: sql<number>`coalesce(max(${issues.number}), 0)` })
    .from(issues)
    .where(eq(issues.workspaceId, workspace.id))
    .get()
  let number = (maxNumberRow?.maxNum ?? 0) + 1

  while (true) {
    const id = formatIssueId(prefix, number)
    const existing = db().select({ id: issues.id }).from(issues).where(eq(issues.id, id)).get()
    if (!existing) {
      return { id, number }
    }
    number += 1
  }
}

export function listStatuses(workspaceId?: string): IssueStatus[] {
  if (workspaceId) {
    requireWorkspace(workspaceId)
    seedDefaultStatuses(workspaceId)
    return readWorkspaceStatuses(workspaceId)
  }
  return db().select().from(issueStatuses).orderBy(issueStatuses.workspaceId, issueStatuses.order).all()
}

export function createStatus(rawInput: { workspaceId: string, name: string, color?: string | null, category?: StatusCategory }): IssueStatus {
  const input = CreateStatusInputSchema.parse(rawInput)
  requireWorkspace(input.workspaceId)
  const count = countStatuses(input.workspaceId)
  return createStatusRow({ ...input, order: count })
}

export function updateStatus(id: string, patch: { name?: string, color?: string | null }): IssueStatus {
  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    updates.name = patch.name
  }
  if ('color' in patch) {
    updates.color = patch.color ?? null
  }
  if (Object.keys(updates).length > 0) {
    db().update(issueStatuses).set(updates).where(eq(issueStatuses.id, id)).run()
  }
  const status = db().select().from(issueStatuses).where(eq(issueStatuses.id, id)).get()
  if (!status) {
    throw new AppError({ code: 'issue_status_not_found', status: 404, message: 'Status not found', details: { statusId: id } })
  }
  return status
}

export function deleteStatus(id: string): void {
  if (!db().select().from(issueStatuses).where(eq(issueStatuses.id, id)).get()) {
    throw new AppError({ code: 'issue_status_not_found', status: 404, message: 'Status not found', details: { statusId: id } })
  }
  db().delete(issueStatuses).where(eq(issueStatuses.id, id)).run()
}

export function reorderStatuses(workspaceId: string, orderedIds: string[]): void {
  requireWorkspace(workspaceId)
  orderedIds.forEach((id, index) => {
    db().update(issueStatuses).set({ order: index }).where(eq(issueStatuses.id, id)).run()
  })
}

export function listMilestones(workspaceId?: string): IssueMilestone[] {
  if (workspaceId) {
    requireWorkspace(workspaceId)
  }
  const predicates = [
    workspaceId ? eq(issueMilestones.workspaceId, workspaceId) : undefined,
  ].filter(predicate => predicate !== undefined)
  return db()
    .select()
    .from(issueMilestones)
    .where(predicates.length > 0 ? and(...predicates) : undefined)
    .orderBy(desc(issueMilestones.createdAt))
    .all()
}

export function createMilestone(rawInput: { workspaceId: string, title: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): IssueMilestone {
  const input = CreateMilestoneInputSchema.parse(rawInput)
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  return db().insert(issueMilestones).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

export function updateMilestone(id: string, patch: { title?: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): IssueMilestone {
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if (patch.title !== undefined) {
    updates.title = patch.title
  }
  if ('description' in patch) {
    updates.description = patch.description ?? null
  }
  if ('dueDate' in patch) {
    updates.dueDate = patch.dueDate ?? null
  }
  if (patch.status !== undefined) {
    updates.status = patch.status
  }
  db().update(issueMilestones).set(updates).where(eq(issueMilestones.id, id)).run()
  const milestone = db().select().from(issueMilestones).where(eq(issueMilestones.id, id)).get()
  if (!milestone) {
    throw new AppError({ code: 'issue_milestone_not_found', status: 404, message: 'Milestone not found', details: { milestoneId: id } })
  }
  return milestone
}

export function deleteMilestone(id: string): void {
  if (!db().select().from(issueMilestones).where(eq(issueMilestones.id, id)).get()) {
    throw new AppError({ code: 'issue_milestone_not_found', status: 404, message: 'Milestone not found', details: { milestoneId: id } })
  }
  db().update(issues).set({ milestoneId: null, updatedAt: currentUnixSeconds() }).where(eq(issues.milestoneId, id)).run()
  db().delete(issueMilestones).where(eq(issueMilestones.id, id)).run()
}

export interface IssueListParams {
  workspaceId?: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

export function listIssues(params: IssueListParams): IssueView[] {
  if (params.workspaceId) {
    requireWorkspace(params.workspaceId)
  }
  const predicates = [
    params.workspaceId ? eq(issues.workspaceId, params.workspaceId) : undefined,
  ].filter(predicate => predicate !== undefined)
  const rows = db()
    .select()
    .from(issues)
    .where(predicates.length > 0 ? and(...predicates) : undefined)
    .orderBy(desc(issues.createdAt))
    .all()

  return rows
    .map(toIssueView)
    .filter(issue => params.milestoneId === undefined || issue.milestoneId === (params.milestoneId ?? null))
    .filter(issue => params.parentIssueId === undefined || issue.parentIssueId === (params.parentIssueId ?? null))
    .filter(issue => params.priority == null || issue.priority === params.priority)
    .filter(issue => params.statusId === undefined || issue.statusId === (params.statusId ?? null))
    .filter((issue) => {
      if (!params.labels || params.labels.length === 0) {
        return true
      }
      return params.labels.every(label => issue.labels.includes(label))
    })
}

function getIssueRow(id: string): Issue {
  const issue = db().select().from(issues).where(eq(issues.id, id)).get()
  if (!issue) {
    throw new AppError({ code: 'issue_not_found', status: 404, message: 'Issue not found', details: { issueId: id } })
  }
  return issue
}

function requireMilestoneInWorkspace(workspaceId: string, milestoneId: string | null): string | null {
  if (milestoneId === null) {
    return null
  }
  const milestone = db()
    .select({ id: issueMilestones.id })
    .from(issueMilestones)
    .where(and(eq(issueMilestones.id, milestoneId), eq(issueMilestones.workspaceId, workspaceId)))
    .get()
  if (!milestone) {
    throw new AppError({
      code: 'issue_milestone_not_found',
      status: 404,
      message: 'Milestone not found',
      details: { workspaceId, milestoneId },
    })
  }
  return milestone.id
}

function issueMilestoneBelongsToWorkspace(milestoneId: string, workspaceId: string): boolean {
  const row = db()
    .select({ id: issueMilestones.id })
    .from(issueMilestones)
    .where(and(eq(issueMilestones.id, milestoneId), eq(issueMilestones.workspaceId, workspaceId)))
    .get()
  return row !== undefined
}

function issueBelongsToWorkspace(issueId: string, workspaceId: string): boolean {
  const row = db()
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .get()
  return row !== undefined
}

function requireParentIssueInWorkspace(workspaceId: string, parentIssueId: string | null, issueId?: string): string | null {
  if (parentIssueId === null) {
    return null
  }
  if (parentIssueId === issueId) {
    throw new AppError({
      code: 'issue_parent_self_reference',
      status: 400,
      message: 'Issue cannot be its own parent',
      details: { issueId, parentIssueId },
    })
  }
  if (!issueBelongsToWorkspace(parentIssueId, workspaceId)) {
    throw new AppError({
      code: 'issue_parent_not_found',
      status: 404,
      message: 'Parent issue not found',
      details: { workspaceId, parentIssueId },
    })
  }
  return parentIssueId
}

function nextIssueNumber(workspaceId: string): number {
  const maxNumberRow = db()
    .select({ maxNum: sql<number>`coalesce(max(${issues.number}), 0)` })
    .from(issues)
    .where(eq(issues.workspaceId, workspaceId))
    .get()
  return (maxNumberRow?.maxNum ?? 0) + 1
}

function nextIssueOrder(workspaceId: string): number {
  const maxOrderRow = db()
    .select({ maxOrder: sql<number>`coalesce(max(${issues.order}), 0)` })
    .from(issues)
    .where(eq(issues.workspaceId, workspaceId))
    .get()
  return (maxOrderRow?.maxOrder ?? 0) + 1024
}

function hasIssueNumberConflict(workspaceId: string, number: number, issueId: string): boolean {
  const row = db()
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.number, number)))
    .get()
  return row !== undefined && row.id !== issueId
}

export function getIssue(id: string): IssueView {
  return toIssueView(getIssueRow(id))
}

function toIssueView(issue: Issue): IssueView {
  return {
    ...issue,
    labels: IssueLabelsJsonSchema.parse(issue.labels),
  }
}

export function searchIssues(q: string, limit = 20): IssueView[] {
  const lowerQ = q.toLowerCase()
  const all = db().select().from(issues).orderBy(desc(issues.createdAt)).all()
  return all
    .filter((issue) => {
      const searchableText = [
        issue.id,
        String(issue.number),
        issue.title,
        issue.description ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return searchableText.includes(lowerQ)
    })
    .slice(0, limit)
    .map(toIssueView)
}

export function createIssue(rawInput: {
  workspaceId: string
  title: string
  description?: string | null
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
  statusName?: string | null
  dueDate?: number | null
  assigneeKind?: string | null
  assigneeId?: string | null
}, actor: MutationActor = { kind: 'user', id: '__self__', source: 'default-user', chatSessionId: null }): IssueView {
  const input = CreateIssueInputSchema.parse(rawInput)
  const workspace = requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  const identity = nextIssueIdentity(workspace)
  const order = nextIssueOrder(input.workspaceId)
  const statusId = resolveStatusId(input.workspaceId, input, { useDefaultWhenMissing: true })
  const milestoneId = requireMilestoneInWorkspace(input.workspaceId, input.milestoneId)
  const parentIssueId = requireParentIssueInWorkspace(input.workspaceId, input.parentIssueId, identity.id)
  const issue = db().insert(issues).values({
    id: identity.id,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description,
    priority: input.priority,
    labels: JSON.stringify(input.labels),
    milestoneId,
    parentIssueId,
    statusId,
    number: identity.number,
    assigneeKind: input.assigneeKind,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
    createdByKind: actor.kind,
    createdById: actor.id,
    sourceChatSessionId: actor.chatSessionId,
    delegateAgentId: null,
    delegateProviderTargetId: null,
    contextRefs: '[]',
    order,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
  return toIssueView(issue)
}

const TRACKED_FIELDS = [
  'workspaceId',
  'title',
  'description',
  'priority',
  'labels',
  'milestoneId',
  'parentIssueId',
  'statusId',
  'assigneeKind',
  'assigneeId',
  'dueDate',
  'delegateAgentId',
  'delegateProviderTargetId',
  'contextRefs',
  'order',
] as const

function normalizeIssueMutationActor(actor: MutationActor | IssueMutationActor): IssueMutationActor {
  return {
    kind: actor.kind,
    id: actor.id ?? null,
    sourceChatSessionId: 'chatSessionId' in actor ? actor.chatSessionId : actor.sourceChatSessionId ?? null,
  }
}

function recordFieldChanges(issueId: string, before: Issue, updates: Record<string, unknown>, rawActor: MutationActor | IssueMutationActor): void {
  const now = currentUnixSeconds()
  const actor = normalizeIssueMutationActor(rawActor)
  for (const field of TRACKED_FIELDS) {
    if (!(field in updates)) {
      continue
    }
    const dbField = field === 'labels' ? 'labels' : field
    const rawBefore = before[dbField as keyof Issue]
    const rawAfter = updates[field]
    const fromValue = rawBefore == null ? null : String(rawBefore)
    const toValue = rawAfter == null ? null : String(rawAfter)
    if (fromValue === toValue) {
      continue
    }
    db().insert(issueFieldChanges).values({
      id: randomUUID(),
      issueId,
      field,
      fromValue,
      toValue,
      actorKind: actor.kind,
      actorId: actor.id ?? null,
      sourceChatSessionId: actor.sourceChatSessionId ?? null,
      createdAt: now,
    }).run()
  }
}

export function updateIssue(id: string, patch: Partial<{
  workspaceId: string
  title: string
  description: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels: string[]
  milestoneId: string | null
  parentIssueId: string | null
  statusId: string | null
  statusName: string | null
  assigneeKind: string | null
  assigneeId: string | null
  dueDate: number | null
  order: number
}>, actor: MutationActor | IssueMutationActor = { kind: 'user', id: '__self__' }): IssueView {
  const issue = getIssueRow(id)
  const targetWorkspaceId = patch.workspaceId ?? issue.workspaceId
  const workspaceChanged = targetWorkspaceId !== issue.workspaceId
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if ('workspaceId' in patch) {
    requireWorkspace(targetWorkspaceId)
    updates.workspaceId = targetWorkspaceId
  }
  if (workspaceChanged) {
    if (!('statusId' in patch) && !('statusName' in patch)) {
      updates.statusId = resolveStatusId(targetWorkspaceId, {}, { useDefaultWhenMissing: true })
    }
    if (!('milestoneId' in patch)) {
      updates.milestoneId = issue.milestoneId && issueMilestoneBelongsToWorkspace(issue.milestoneId, targetWorkspaceId)
        ? issue.milestoneId
        : null
    }
    if (!('parentIssueId' in patch)) {
      updates.parentIssueId = issue.parentIssueId && issueBelongsToWorkspace(issue.parentIssueId, targetWorkspaceId)
        ? issue.parentIssueId
        : null
    }
    if (patch.order === undefined) {
      updates.order = nextIssueOrder(targetWorkspaceId)
    }
    if (hasIssueNumberConflict(targetWorkspaceId, issue.number, issue.id)) {
      updates.number = nextIssueNumber(targetWorkspaceId)
    }
  }
  if (patch.title !== undefined) {
    updates.title = patch.title
  }
  if ('description' in patch) {
    updates.description = patch.description ?? null
  }
  if (patch.priority !== undefined) {
    updates.priority = patch.priority
  }
  if (patch.labels !== undefined) {
    updates.labels = JSON.stringify(patch.labels)
  }
  if ('milestoneId' in patch) {
    updates.milestoneId = requireMilestoneInWorkspace(targetWorkspaceId, patch.milestoneId ?? null)
  }
  if ('parentIssueId' in patch) {
    updates.parentIssueId = requireParentIssueInWorkspace(targetWorkspaceId, patch.parentIssueId ?? null, id)
  }
  if ('statusId' in patch || 'statusName' in patch) {
    updates.statusId = resolveStatusId(targetWorkspaceId, patch, { useDefaultWhenMissing: false })
  }
  if ('assigneeKind' in patch) {
    updates.assigneeKind = patch.assigneeKind ?? null
  }
  if ('assigneeId' in patch) {
    updates.assigneeId = patch.assigneeId ?? null
  }
  if ('dueDate' in patch) {
    updates.dueDate = patch.dueDate ?? null
  }
  if (patch.order !== undefined) {
    updates.order = patch.order
  }

  recordFieldChanges(id, issue, updates, actor)
  db().update(issues).set(updates).where(eq(issues.id, id)).run()
  return getIssue(id)
}

export function listFieldChanges(issueId: string): IssueFieldChangeView[] {
  getIssueRow(issueId)
  return db().select().from(issueFieldChanges).where(eq(issueFieldChanges.issueId, issueId)).orderBy(issueFieldChanges.createdAt).all()
}

const HIDDEN_ACTIVITY_FIELDS = new Set([
  'assigneeKind',
  'contextRefs',
  'delegateAgentId',
  'delegateProviderTargetId',
  'order',
])

const ACTIVITY_FIELD_BY_RAW_FIELD: Record<string, IssueActivityField> = {
  assigneeId: 'assignee',
  description: 'description',
  dueDate: 'due-date',
  labels: 'labels',
  milestoneId: 'milestone',
  parentIssueId: 'parent',
  priority: 'priority',
  statusId: 'status',
  title: 'title',
  workspaceId: 'workspace',
}

const PRIORITY_ACTIVITY_VALUE_TOKEN: Record<string, IssueActivityValueToken> = {
  none: 'priority-none',
  low: 'priority-low',
  medium: 'priority-medium',
  high: 'priority-high',
  urgent: 'priority-urgent',
}

interface IssueActivityLookup {
  issue: Issue
  issueById: Map<string, Pick<Issue, 'id' | 'title'>>
  milestoneById: Map<string, Pick<IssueMilestone, 'id' | 'title'>>
  statusById: Map<string, Pick<IssueStatus, 'id' | 'name'>>
  workspaceById: Map<string, Pick<Workspace, 'id' | 'name'>>
}

export function listActivity(issueId: string): IssueActivityItemView[] {
  const issue = getIssueRow(issueId)
  const lookup = buildActivityLookup(issue)
  const commentItems = db()
    .select()
    .from(issueComments)
    .where(eq(issueComments.issueId, issueId))
    .orderBy(issueComments.createdAt)
    .all()
    .map(toCommentActivityItem)
  const fieldChangeItems = db()
    .select()
    .from(issueFieldChanges)
    .where(eq(issueFieldChanges.issueId, issueId))
    .orderBy(issueFieldChanges.createdAt)
    .all()
    .map(change => toFieldChangeActivityItem(change, lookup))
    .filter((item): item is IssueActivityItemView => item !== null)
  const createdItem: IssueActivityItemView = {
    id: `${issue.id}:created`,
    issueId: issue.id,
    kind: 'created',
    actor: resolveIssueActor({ kind: issue.createdByKind, id: issue.createdById }),
    comment: null,
    fieldChange: null,
    sourceChatSessionId: issue.sourceChatSessionId,
    createdAt: issue.createdAt,
  }

  return [
    createdItem,
    ...fieldChangeItems,
    ...commentItems,
  ].toSorted((left, right) => {
    const createdAtDelta = left.createdAt - right.createdAt
    if (createdAtDelta !== 0) {
      return createdAtDelta
    }
    return activityKindOrder(left.kind) - activityKindOrder(right.kind)
  })
}

function buildActivityLookup(issue: Issue): IssueActivityLookup {
  const workspaceIssues = db()
    .select({
      id: issues.id,
      title: issues.title,
    })
    .from(issues)
    .all()
  const workspaceMilestones = db()
    .select({
      id: issueMilestones.id,
      title: issueMilestones.title,
    })
    .from(issueMilestones)
    .all()
  const workspaceStatuses = db()
    .select({
      id: issueStatuses.id,
      name: issueStatuses.name,
    })
    .from(issueStatuses)
    .all()
  const workspaceRows = db()
    .select({
      id: workspaces.id,
      name: workspaces.name,
    })
    .from(workspaces)
    .all()

  return {
    issue,
    issueById: new Map(workspaceIssues.map(row => [row.id, row])),
    milestoneById: new Map(workspaceMilestones.map(row => [row.id, row])),
    statusById: new Map(workspaceStatuses.map(row => [row.id, row])),
    workspaceById: new Map(workspaceRows.map(row => [row.id, row])),
  }
}

function activityKindOrder(kind: IssueActivityItemView['kind']): number {
  if (kind === 'created') {
    return 0
  }
  if (kind === 'field-change') {
    return 1
  }
  return 2
}

function toCommentActivityItem(comment: IssueComment): IssueActivityItemView {
  return {
    id: comment.id,
    issueId: comment.issueId,
    kind: 'comment',
    actor: resolveCommentAuthor(comment),
    comment: {
      content: comment.content,
      systemKind: readSystemCommentKind(comment.authorKind),
    },
    fieldChange: null,
    sourceChatSessionId: comment.sourceChatSessionId,
    createdAt: comment.createdAt,
  }
}

function readSystemCommentKind(authorKind: IssueComment['authorKind']): IssueActivityCommentView['systemKind'] {
  if (authorKind === 'system.delegated') {
    return 'delegated'
  }
  if (authorKind === 'system.undelegated') {
    return 'undelegated'
  }
  if (authorKind === 'system') {
    return 'system'
  }
  return null
}

function toFieldChangeActivityItem(change: IssueFieldChange, lookup: IssueActivityLookup): IssueActivityItemView | null {
  if (HIDDEN_ACTIVITY_FIELDS.has(change.field)) {
    return null
  }

  const field = ACTIVITY_FIELD_BY_RAW_FIELD[change.field] ?? 'metadata'
  const fieldChange = formatActivityFieldChange(change, field, lookup)
  if (!fieldChange) {
    return null
  }

  return {
    id: change.id,
    issueId: change.issueId,
    kind: 'field-change',
    actor: resolveIssueActor({ kind: change.actorKind, id: change.actorId }),
    comment: null,
    fieldChange,
    sourceChatSessionId: change.sourceChatSessionId,
    createdAt: change.createdAt,
  }
}

function formatActivityFieldChange(
  change: IssueFieldChange,
  field: IssueActivityField,
  lookup: IssueActivityLookup,
): IssueActivityFieldChangeView | null {
  if (field === 'description') {
    if (isEmptyActivityValue(change.fromValue) && !isEmptyActivityValue(change.toValue)) {
      return { action: 'added-description', field, fromValue: null, toValue: null }
    }
    if (!isEmptyActivityValue(change.fromValue) && isEmptyActivityValue(change.toValue)) {
      return { action: 'cleared-description', field, fromValue: null, toValue: null }
    }
    return { action: 'updated-description', field, fromValue: null, toValue: null }
  }

  if (field === 'title') {
    return {
      action: 'renamed-issue',
      field,
      fromValue: formatActivityFieldValue(field, change.fromValue, lookup),
      toValue: formatActivityFieldValue(field, change.toValue, lookup),
    }
  }

  return {
    action: 'changed-field',
    field,
    fromValue: formatActivityFieldValue(field, change.fromValue, lookup),
    toValue: formatActivityFieldValue(field, change.toValue, lookup),
  }
}

function formatActivityFieldValue(
  field: IssueActivityField,
  value: string | null,
  lookup: IssueActivityLookup,
): IssueActivityValueView {
  switch (field) {
    case 'assignee':
      if (isEmptyActivityValue(value)) {
        return activityToken('unassigned')
      }
      if (value === '__self__') {
        return activityToken('current-user')
      }
      return resolveAgentValue(value) ?? activityToken('unknown-user')

    case 'due-date': {
      if (isEmptyActivityValue(value)) {
        return activityToken('no-due-date')
      }
      const timestamp = Number(value)
      if (!Number.isFinite(timestamp)) {
        return activityToken('changed')
      }
      return { kind: 'date', timestamp }
    }

    case 'labels': {
      const labels = parseActivityStringArray(value)
      if (!labels || labels.length === 0) {
        return activityToken('no-labels')
      }
      return { kind: 'text', text: labels.join(', ') }
    }

    case 'milestone':
      if (isEmptyActivityValue(value)) {
        return activityToken('no-milestone')
      }
      return activityText(lookup.milestoneById.get(value)?.title ?? null) ?? activityToken('unknown-milestone')

    case 'parent':
      if (isEmptyActivityValue(value)) {
        return activityToken('no-parent')
      }
      return formatActivityIssueReference(value, lookup)

    case 'priority':
      return activityToken(PRIORITY_ACTIVITY_VALUE_TOKEN[value ?? ''] ?? 'priority-none')

    case 'status':
      if (isEmptyActivityValue(value)) {
        return activityToken('no-status')
      }
      return activityText(lookup.statusById.get(value)?.name ?? null) ?? activityToken('unknown-status')

    case 'title':
      return formatPlainActivityValue(value)

    case 'workspace':
      if (isEmptyActivityValue(value)) {
        return activityToken('empty')
      }
      return activityText(lookup.workspaceById.get(value)?.name ?? null) ?? formatPlainActivityValue(value)

    default:
      return formatPlainActivityValue(value)
  }
}

function resolveAgentValue(agentId: string | null): IssueActivityValueView | null {
  if (!agentId) {
    return null
  }
  const agent = db()
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get()
  return activityText(agent?.name ?? null)
}

function formatActivityIssueReference(value: string | null, lookup: IssueActivityLookup): IssueActivityValueView {
  if (!value) {
    return activityToken('no-parent')
  }
  const issue = lookup.issueById.get(value)
  if (!issue) {
    return activityToken('unknown-issue')
  }
  return { kind: 'text', text: `${issue.id} ${issue.title}` }
}

function formatPlainActivityValue(value: string | null): IssueActivityValueView {
  if (isEmptyActivityValue(value)) {
    return activityToken('empty')
  }

  const trimmed = value.trim()
  if (trimmed.length > 96) {
    return activityToken('changed')
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return activityToken('changed')
  }
  if (/^(external_provider_target|provider_target|agent_session)_/.test(trimmed)) {
    return activityToken('changed')
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return activityToken('changed')
  }
  return { kind: 'text', text: trimmed }
}

function parseActivityStringArray(value: string | null): string[] | null {
  if (value == null || value === '') {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed
    }
  }
  catch {
    return null
  }

  return null
}

function isEmptyActivityValue(value: string | null): value is null | '' | '[]' {
  return value == null || value === '' || value === '[]'
}

function activityText(text: string | null): IssueActivityValueView | null {
  const trimmed = text?.trim()
  if (!trimmed) {
    return null
  }
  return { kind: 'text', text: trimmed }
}

function activityToken(token: IssueActivityValueToken): IssueActivityValueView {
  return { kind: 'token', token }
}

export function moveIssueToStatusName(id: string, statusName: string, actor?: MutationActor | IssueMutationActor): IssueView {
  return updateIssue(id, { statusName }, actor)
}

export function updateIssueDelegation(
  id: string,
  delegation: { agentId: string, providerTargetId: string } | null,
  actor: MutationActor | IssueMutationActor = { kind: 'system', id: 'issue-agent' },
): IssueView {
  const issue = getIssueRow(id)
  const updates = {
    delegateAgentId: delegation?.agentId ?? null,
    delegateProviderTargetId: delegation?.providerTargetId ?? null,
    updatedAt: currentUnixSeconds(),
  }
  recordFieldChanges(id, issue, updates, actor)
  db().update(issues).set(updates).where(eq(issues.id, id)).run()
  return getIssue(id)
}

export function deleteIssue(id: string): void {
  getIssueRow(id)
  db().update(issues).set({ parentIssueId: null, updatedAt: currentUnixSeconds() }).where(eq(issues.parentIssueId, id)).run()
  db().delete(issues).where(eq(issues.id, id)).run()
}

export function bulkUpdateIssues(issueIds: string[], update: {
  statusId?: string | null
  priority?: string
  labels?: string[]
  milestoneId?: string | null
  assigneeKind?: string | null
  assigneeId?: string | null
  dueDate?: number | null
}, actor: MutationActor | IssueMutationActor = { kind: 'user', id: '__self__' }): number {
  if (issueIds.length === 0) {
    return 0
  }
  const uniqueIssueIds = [...new Set(issueIds)]
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if ('statusId' in update) {
    updates.statusId = update.statusId ?? null
  }
  if (update.priority !== undefined) {
    updates.priority = update.priority
  }
  if (update.labels !== undefined) {
    updates.labels = JSON.stringify(update.labels)
  }
  if ('milestoneId' in update) {
    updates.milestoneId = update.milestoneId ?? null
  }
  if ('assigneeKind' in update) {
    updates.assigneeKind = update.assigneeKind ?? null
  }
  if ('assigneeId' in update) {
    updates.assigneeId = update.assigneeId ?? null
  }
  if ('dueDate' in update) {
    updates.dueDate = update.dueDate ?? null
  }

  const beforeRows = db()
    .select()
    .from(issues)
    .where(sql`${issues.id} IN (${sql.join(uniqueIssueIds.map(id => sql`${id}`), sql`, `)})`)
    .all()

  for (const issue of beforeRows) {
    if ('statusId' in update && update.statusId !== null && update.statusId !== undefined) {
      resolveStatusId(issue.workspaceId, { statusId: update.statusId }, { useDefaultWhenMissing: false })
    }
    if ('milestoneId' in update) {
      requireMilestoneInWorkspace(issue.workspaceId, update.milestoneId ?? null)
    }
    recordFieldChanges(issue.id, issue, updates, actor)
  }

  const result = db().update(issues).set(updates).where(sql`${issues.id} IN (${sql.join(uniqueIssueIds.map(id => sql`${id}`), sql`, `)})`).run()
  return result.changes
}

export function listComments(issueId: string): IssueCommentView[] {
  getIssueRow(issueId)
  return db().select().from(issueComments).where(eq(issueComments.issueId, issueId)).orderBy(issueComments.createdAt).all().map(toCommentView)
}

export function addComment(rawInput: {
  issueId: string
  content: string
  authorKind?: IssueCommentAuthorKind
  authorId?: string | null
  sourceChatSessionId?: string | null
}): IssueCommentView {
  const input = AddCommentInputSchema.parse(rawInput)
  getIssue(input.issueId)
  const comment = db().insert(issueComments).values({
    id: randomUUID(),
    issueId: input.issueId,
    content: input.content,
    authorKind: input.authorKind,
    authorId: input.authorId,
    sourceChatSessionId: input.sourceChatSessionId,
    agentActivityId: null,
    createdAt: currentUnixSeconds(),
  }).returning().get()
  return toCommentView(comment)
}

function toCommentView(comment: IssueComment): IssueCommentView {
  return {
    ...comment,
    author: resolveCommentAuthor(comment),
  }
}

function resolveCommentAuthor(comment: IssueComment): IssueCommentAuthorView {
  return resolveIssueActor({
    kind: normalizeCommentAuthorKind(comment.authorKind),
    id: comment.authorId,
  })
}

function normalizeCommentAuthorKind(authorKind: IssueComment['authorKind']): IssueActorKind {
  if (authorKind === 'system' || authorKind === 'system.delegated' || authorKind === 'system.undelegated') {
    return 'system'
  }
  return authorKind
}

function resolveIssueActor(actor: { kind: IssueActorKind, id: string | null }): IssueCommentAuthorView {
  if (actor.kind === 'system') {
    return {
      kind: 'system',
      id: null,
      displayName: 'Cradle',
      avatarUrl: null,
      label: 'System',
    }
  }

  if (actor.kind === 'agent') {
    const agent = actor.id
      ? db()
          .select({
            id: agents.id,
            name: agents.name,
            avatarUrl: agents.avatarUrl,
            runtimeKind: agents.runtimeKind,
          })
          .from(agents)
          .where(eq(agents.id, actor.id))
          .get()
      : null

    return {
      kind: 'agent',
      id: agent?.id ?? actor.id ?? null,
      displayName: agent?.name ?? 'Unknown agent',
      avatarUrl: agent?.avatarUrl ?? null,
      label: readRuntimeIssueActorLabel(agent?.runtimeKind),
    }
  }

  if (actor.kind === 'provider-target') {
    const target = actor.id
      ? db()
          .select({
            id: providerTargets.id,
            displayName: providerTargets.displayName,
          })
          .from(providerTargets)
          .where(eq(providerTargets.id, actor.id))
          .get()
      : null

    return {
      kind: 'provider-target',
      id: target?.id ?? actor.id ?? null,
      displayName: target?.displayName ?? 'Unknown provider',
      avatarUrl: null,
      label: target ? 'Provider' : null,
    }
  }

  return {
    kind: 'user',
    id: actor.id ?? '__self__',
    displayName: 'You',
    avatarUrl: null,
    label: null,
  }
}

export function deleteComment(id: string): void {
  if (!db().select().from(issueComments).where(eq(issueComments.id, id)).get()) {
    throw new AppError({ code: 'issue_comment_not_found', status: 404, message: 'Comment not found', details: { commentId: id } })
  }
  db().delete(issueComments).where(eq(issueComments.id, id)).run()
}

export function listRelations(issueId: string): IssueRelation[] {
  getIssueRow(issueId)
  return db()
    .select()
    .from(issueRelations)
    .where(or(eq(issueRelations.sourceIssueId, issueId), eq(issueRelations.targetIssueId, issueId)))
    .all()
}

export function createRelation(input: { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }): IssueRelation {
  getIssueRow(input.sourceIssueId)
  getIssueRow(input.targetIssueId)
  return db().insert(issueRelations).values({
    id: randomUUID(),
    sourceIssueId: input.sourceIssueId,
    targetIssueId: input.targetIssueId,
    type: input.type,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

export function deleteRelation(id: string): void {
  if (!db().select().from(issueRelations).where(eq(issueRelations.id, id)).get()) {
    throw new AppError({ code: 'issue_relation_not_found', status: 404, message: 'Relation not found', details: { relationId: id } })
  }
  db().delete(issueRelations).where(eq(issueRelations.id, id)).run()
}

export function addContextRef(
  issueId: string,
  ref: string,
  actor: MutationActor | IssueMutationActor = { kind: 'user', id: '__self__' },
): IssueView {
  const issue = getIssue(issueId)
  const refs = IssueContextRefsJsonSchema.parse(issue.contextRefs)
  refs.push(ref)
  const row = getIssueRow(issueId)
  const updates = { contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }
  recordFieldChanges(issueId, row, updates, actor)
  db().update(issues).set(updates).where(eq(issues.id, issueId)).run()
  return getIssue(issueId)
}

export function removeContextRef(
  issueId: string,
  index: number,
  actor: MutationActor | IssueMutationActor = { kind: 'user', id: '__self__' },
): IssueView {
  const issue = getIssue(issueId)
  const refs = IssueContextRefsJsonSchema.parse(issue.contextRefs)
  if (index < 0 || index >= refs.length) {
    throw new AppError({ code: 'issue_context_ref_invalid_index', status: 400, message: 'Invalid context ref index', details: { issueId, index } })
  }
  refs.splice(index, 1)
  const row = getIssueRow(issueId)
  const updates = { contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }
  recordFieldChanges(issueId, row, updates, actor)
  db().update(issues).set(updates).where(eq(issues.id, issueId)).run()
  return getIssue(issueId)
}

export function getLinkedIssue(sessionId: string): { issueId: string | null } {
  const s = db().select({ linkedIssueId: sessions.linkedIssueId }).from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!s) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
  return { issueId: s.linkedIssueId }
}

export function listLinkedSessions(issueId: string): Session.SessionView[] {
  getIssue(issueId)
  return Session.listLinkedToIssue(issueId)
}

export function linkIssue(sessionId: string, issueId: string): { ok: true } {
  const s = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!s) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
  getIssue(issueId)
  db().update(sessions).set({ linkedIssueId: issueId }).where(eq(sessions.id, sessionId)).run()
  return { ok: true }
}

export function unlinkIssue(sessionId: string): { ok: true } {
  const s = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!s) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
  db().update(sessions).set({ linkedIssueId: null }).where(eq(sessions.id, sessionId)).run()
  return { ok: true }
}

export interface MigrateIssuesOptions {
  statusMappings?: Record<string, string>
  milestoneMappings?: Record<string, string>
  dryRun?: boolean
}

export interface MigrateIssuesResult {
  processed: number
  updated: number
  numbersReassigned: number
  statusesMapped: { from: string, to: string }[]
  milestonesMapped: { from: string, to: string | null }[]
  parentIssuesCleared: number
}

export function migrateIssues(sourceId: string, targetId: string, options: MigrateIssuesOptions = {}): MigrateIssuesResult {
  if (sourceId === targetId) {
    throw new AppError({ code: 'issue_migrate_same_workspace', status: 400, message: 'Source and target workspace must be different' })
  }
  requireWorkspace(sourceId)
  requireWorkspace(targetId)
  seedDefaultStatuses(targetId)

  // Phase 1: Build status mapping (source status name → target status ID)
  const sourceStatuses = readWorkspaceStatuses(sourceId)
  const targetStatuses = readWorkspaceStatuses(targetId)
  const targetStatusByName = new Map(targetStatuses.map(s => [normalizeStatusName(s.name), s]))
  const defaultTargetStatusId = targetStatuses[0]?.id ?? null

  const statusIdMap = new Map<string, string | null>()
  const statusesMapped: { from: string, to: string }[] = []
  for (const src of sourceStatuses) {
    const explicitTarget = options.statusMappings?.[src.name]
    const matchName = explicitTarget ?? src.name
    const target = targetStatusByName.get(normalizeStatusName(matchName))
    if (target) {
      statusIdMap.set(src.id, target.id)
      statusesMapped.push({ from: src.name, to: target.name })
    } else {
      statusIdMap.set(src.id, defaultTargetStatusId)
      statusesMapped.push({ from: src.name, to: targetStatuses[0]?.name ?? '(none)' })
    }
  }

  // Phase 2: Build milestone mapping (source milestone title → target milestone ID)
  const sourceMilestones = db().select().from(issueMilestones).where(eq(issueMilestones.workspaceId, sourceId)).all()
  const targetMilestones = db().select().from(issueMilestones).where(eq(issueMilestones.workspaceId, targetId)).all()
  const targetMilestoneByTitle = new Map(targetMilestones.map(m => [m.title.trim().toLowerCase(), m]))

  const milestoneIdMap = new Map<string, string | null>()
  const milestonesMapped: { from: string, to: string | null }[] = []
  for (const src of sourceMilestones) {
    const explicitTarget = options.milestoneMappings?.[src.title]
    const matchTitle = explicitTarget ?? src.title
    const target = targetMilestoneByTitle.get(matchTitle.trim().toLowerCase())
    if (target) {
      milestoneIdMap.set(src.id, target.id)
      milestonesMapped.push({ from: src.title, to: target.title })
    } else {
      milestoneIdMap.set(src.id, null)
      milestonesMapped.push({ from: src.title, to: null })
    }
  }

  // Phase 3: Migrate issues
  const sourceIssues = db().select().from(issues).where(eq(issues.workspaceId, sourceId)).all()
  let numbersReassigned = 0
  let parentIssuesCleared = 0

  // Dry run: count only
  if (options.dryRun) {
    for (const issue of sourceIssues) {
      if (hasIssueNumberConflict(targetId, issue.number, issue.id)) {
        numbersReassigned++
      }
      if (issue.parentIssueId) {
        const parent = db().select({ workspaceId: issues.workspaceId }).from(issues).where(eq(issues.id, issue.parentIssueId)).get()
        if (parent && parent.workspaceId === sourceId) {
          // parent also in source — will move together, keep ref
        } else if (parent && parent.workspaceId !== targetId) {
          parentIssuesCleared++
        }
      }
    }
    return {
      processed: sourceIssues.length,
      updated: 0,
      numbersReassigned,
      statusesMapped,
      milestonesMapped,
      parentIssuesCleared,
    }
  }

  // Real migration
  let orderCounter = nextIssueOrder(targetId)
  for (const issue of sourceIssues) {
    const updates: Record<string, unknown> = {
      workspaceId: targetId,
      updatedAt: currentUnixSeconds(),
    }

    // Map status
    const mappedStatusId = issue.statusId ? (statusIdMap.get(issue.statusId) ?? defaultTargetStatusId) : defaultTargetStatusId
    updates.statusId = mappedStatusId

    // Map milestone
    if (issue.milestoneId) {
      updates.milestoneId = milestoneIdMap.get(issue.milestoneId) ?? null
    }

    // Resolve number conflict
    if (hasIssueNumberConflict(targetId, issue.number, issue.id)) {
      updates.number = nextIssueNumber(targetId)
      numbersReassigned++
    }

    // Reassign order
    updates.order = orderCounter
    orderCounter += 1024

    // Handle parent issue refs
    if (issue.parentIssueId) {
      const parent = db().select({ workspaceId: issues.workspaceId }).from(issues).where(eq(issues.id, issue.parentIssueId)).get()
      if (parent && parent.workspaceId !== sourceId && parent.workspaceId !== targetId) {
        // Parent in a different workspace — clear ref
        updates.parentIssueId = null
        parentIssuesCleared++
      }
      // Otherwise: parent in source (will move together) or already in target — keep ref
    }

    recordFieldChanges(issue.id, issue, updates, { kind: 'system', id: null })
    db().update(issues).set(updates).where(eq(issues.id, issue.id)).run()
  }

  return {
    processed: sourceIssues.length,
    updated: sourceIssues.length,
    numbersReassigned,
    statusesMapped,
    milestonesMapped,
    parentIssuesCleared,
  }
}
