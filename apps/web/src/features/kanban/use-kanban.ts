import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  deleteIssuesById,
  deleteIssuesByIdContextRefsByIndex,
  deleteIssuesByIdDelegation,
  deleteIssuesCommentsById,
  deleteIssuesMilestonesById,
  deleteIssuesRelationsById,
  deleteIssuesStatusesById,
  deleteKanbanBoardsById,
  deleteSessionsByIdLinkedIssue,
  getExternalIssueSourcesItems,
  getIssues,
  getIssuesById,
  getIssuesByIdActivity,
  getIssuesByIdAgentSessions,
  getIssuesByIdComments,
  getIssuesByIdFieldChanges,
  getIssuesByIdRelations,
  getIssuesByIdSessionGroups,
  getIssuesByIdSessions,
  getIssuesMilestones,
  getIssuesSearch,
  getIssuesStatuses,
  getKanbanBoards,
  getSessionsByIdLinkedIssue,
  patchExternalIssueSourcesItemsByIdStatus,
  patchIssuesBulk,
  patchIssuesById,
  patchIssuesMilestonesById,
  patchIssuesStatusesById,
  patchKanbanBoardsById,
  postIssueAgentSessionsByAgentSessionIdRerun,
  postIssues,
  postIssuesByIdComments,
  postIssuesByIdContextRefs,
  postIssuesByIdDelegation,
  postIssuesMilestones,
  postIssuesRelations,
  postIssuesStatuses,
  postIssuesStatusesReorder,
  postKanbanBoards,
  postSessionsByIdLinkedIssue,
} from '~/api-gen/sdk.gen'
import type {
  AgentSession,
  ExternalIssueItem,
  ExternalKanbanIssue,
  IssueLinkedSession,
  KanbanBoard,
  KanbanBoardIssue,
  KanbanIssue,
  KanbanIssueActivityItem,
  KanbanIssueCommentView,
  KanbanIssueFieldChangeView,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
} from '~/features/kanban/types'
import { queryRefreshPolicies, queryRefreshPolicy } from '~/lib/query-refresh-policy'

// ── Query keys ────────────────────────────────────────────────────────────────

export const kanbanKeys = {
  boards: (workspaceId?: string) => ['kanban', 'boards', workspaceId] as const,
  statuses: (workspaceId: string) => ['kanban', 'statuses', workspaceId] as const,
  milestones: (workspaceId: string) => ['kanban', 'milestones', workspaceId] as const,
  issues: (params: Record<string, unknown>) => ['kanban', 'issues', params] as const,
  searchIssues: (query: string, limit: number) => ['kanban', 'searchIssues', query, limit] as const,
  issue: (id: string) => ['kanban', 'issue', id] as const,
  agentSessions: (issueId: string) => ['kanban', 'agentSessions', issueId] as const,
  linkedSessions: (issueId: string) => ['kanban', 'linkedSessions', issueId] as const,
  linkedSessionGroups: (issueId: string) => ['kanban', 'linkedSessionGroups', issueId] as const,
  activity: (issueId: string) => ['kanban', 'activity', issueId] as const,
  comments: (issueId: string) => ['kanban', 'comments', issueId] as const,
  fieldChanges: (issueId: string) => ['kanban', 'fieldChanges', issueId] as const,
  relations: (issueId: string) => ['kanban', 'relations', issueId] as const,
  externalIssues: (workspaceId: string) => ['kanban', 'externalIssues', workspaceId] as const,
}

// ── Input types ───────────────────────────────────────────────────────────────

type CreateBoardInput = { workspaceId: string, name: string, filterConfig?: string | null }
type UpdateBoardInput = { id: string, patch: { name?: string, filterConfig?: string | null } }

type CreateStatusInput = { workspaceId: string, name: string, color?: string | null }
type UpdateStatusInput = {
  id: string
  workspaceId: string
  patch: { name?: string, color?: string | null }
}
type ReorderStatusesInput = { workspaceId: string, orderedIds: string[] }
type DeleteStatusInput = { id: string, workspaceId: string }

type CreateMilestoneInput = {
  workspaceId: string
  title: string
  description?: string | null
  dueDate?: number | null
}
type UpdateMilestoneInput = {
  id: string
  workspaceId: string
  patch: {
    title?: string
    description?: string | null
    dueDate?: number | null
    status?: 'open' | 'closed'
  }
}
type DeleteMilestoneInput = { id: string, workspaceId: string }

export type IssuePriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

export type IssueFilterParams = {
  workspaceId: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

type CreateIssueInput = {
  workspaceId: string
  title: string
  description?: string | null
  priority?: IssuePriority
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
  dueDate?: number | null
  assigneeKind?: string | null
  assigneeId?: string | null
}

type UpdateIssueInput = {
  id: string
  patch: Partial<{
    workspaceId: string
    title: string
    description: string | null
    priority: IssuePriority
    labels: string[]
    milestoneId: string | null
    parentIssueId: string | null
    statusId: string | null
    assigneeKind: string | null
    assigneeId: string | null
    dueDate: number | null
  }>
}

type PatchIssueLabelsInput = { patches: { issueId: string, labels: string[] }[] }
type BulkUpdateIssuesInput = {
  ids: string[]
  patch: Partial<{
    statusId: string | null
    priority: IssuePriority
    labels: string[]
    milestoneId: string | null
    assigneeKind: string | null
    assigneeId: string | null
    dueDate: number | null
  }>
}
type MoveIssueInput = { id: string, statusId: string | null }
type MoveExternalIssueInput = { id: string, statusId: string }
type AddCommentInput = { issueId: string, content: string }
type DeleteCommentInput = { id: string, issueId: string }
type AddRelationInput = {
  sourceIssueId: string
  targetIssueId: string
  type: 'blocks' | 'duplicates' | 'relates_to'
}
type DeleteRelationInput = { id: string, issueId: string }

type ApiKanbanIssue = KanbanIssue

const KanbanBoardSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  filterConfig: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const KanbanBoardListSchema = z.array(KanbanBoardSchema).default([])

const KanbanStatusSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  category: z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']),
  order: z.number(),
  createdAt: z.number(),
})
const KanbanStatusListSchema = z.array(KanbanStatusSchema).default([])

const KanbanMilestoneSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  dueDate: z.number().nullable(),
  status: z.enum(['open', 'closed']),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const KanbanMilestoneListSchema = z.array(KanbanMilestoneSchema).default([])

const KanbanIssueSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    number: z.number(),
    statusId: z.string().nullable(),
    milestoneId: z.string().nullable(),
    parentIssueId: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
    labels: z.array(z.string()),
    assigneeKind: z.string().nullable(),
    assigneeId: z.string().nullable(),
    dueDate: z.number().nullable(),
    createdByKind: z.enum(['user', 'agent', 'provider-target', 'system']),
    createdById: z.string(),
    sourceChatSessionId: z.string().nullable(),
    delegateAgentId: z.string().nullable(),
    delegateProviderTargetId: z.string().nullable(),
    contextRefs: z.string(),
    order: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough() satisfies z.ZodType<ApiKanbanIssue>
const KanbanIssueListSchema = z.array(KanbanIssueSchema).default([])

const ExternalIssueItemSchema = z
  .object({
    id: z.string(),
    bindingId: z.string(),
    workspaceId: z.string(),
    statusId: z.string().nullable(),
    sourceKey: z.string(),
    externalId: z.string(),
    externalKey: z.string(),
    externalUrl: z.string().nullable(),
    repositoryOwner: z.string(),
    repositoryName: z.string(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    sourceState: z.enum(['open', 'closed']),
    labels: z.array(z.string()),
    assignees: z.array(z.string()),
    milestone: z.string().nullable(),
    sourceCreatedAt: z.string().nullable(),
    sourceUpdatedAt: z.string().nullable(),
    sourceClosedAt: z.string().nullable(),
    syncStatus: z.enum(['active', 'missing', 'error']),
    fingerprint: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    warnings: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.enum(['info', 'warning', 'error']),
      }),
    ),
    lastSeenAt: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough() satisfies z.ZodType<ExternalIssueItem>
const ExternalIssueItemListSchema = z.array(ExternalIssueItemSchema).default([])

const IssueCommentAuthorSchema = z.object({
  kind: z.enum(['user', 'agent', 'provider-target', 'system']),
  id: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  label: z.string().nullable(),
})
const KanbanIssueCommentSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  content: z.string(),
  authorKind: z.enum([
    'user',
    'agent',
    'provider-target',
    'system',
    'system.delegated',
    'system.undelegated',
  ]),
  authorId: z.string().nullable(),
  author: IssueCommentAuthorSchema,
  sourceChatSessionId: z.string().nullable(),
  agentActivityId: z.string().nullable(),
  createdAt: z.number(),
})
const KanbanIssueCommentListSchema = z.array(KanbanIssueCommentSchema).default([])

const IssueActivityValueTokenSchema = z.enum([
  'changed',
  'current-user',
  'empty',
  'no-due-date',
  'no-labels',
  'no-milestone',
  'no-parent',
  'no-status',
  'priority-high',
  'priority-low',
  'priority-medium',
  'priority-none',
  'priority-urgent',
  'unassigned',
  'unknown-issue',
  'unknown-milestone',
  'unknown-status',
  'unknown-user',
])
const IssueActivityValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), timestamp: z.number() }),
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('token'), token: IssueActivityValueTokenSchema }),
])
const KanbanIssueActivityItemSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  kind: z.enum(['comment', 'created', 'field-change']),
  actor: IssueCommentAuthorSchema,
  comment: z
    .object({
      content: z.string(),
      systemKind: z.enum(['delegated', 'system', 'undelegated']).nullable(),
    })
    .nullable(),
  fieldChange: z
    .object({
      action: z.enum([
        'added-description',
        'changed-field',
        'cleared-description',
        'renamed-issue',
        'updated-description',
      ]),
      field: z
        .enum([
          'assignee',
          'description',
          'due-date',
          'labels',
          'metadata',
          'milestone',
          'parent',
          'priority',
          'status',
          'title',
        ])
        .nullable(),
      fromValue: IssueActivityValueSchema.nullable(),
      toValue: IssueActivityValueSchema.nullable(),
    })
    .nullable(),
  sourceChatSessionId: z.string().nullable(),
  createdAt: z.number(),
})
const KanbanIssueActivityListSchema = z.array(KanbanIssueActivityItemSchema).default([])

const KanbanIssueFieldChangeSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  field: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  actorKind: z.enum(['user', 'agent', 'provider-target', 'system']),
  actorId: z.string().nullable(),
  sourceChatSessionId: z.string().nullable(),
  createdAt: z.number(),
})
const KanbanIssueFieldChangeListSchema = z.array(KanbanIssueFieldChangeSchema).default([])

const KanbanIssueRelationSchema = z.object({
  id: z.string(),
  sourceIssueId: z.string(),
  targetIssueId: z.string(),
  type: z.enum(['blocks', 'duplicates', 'relates_to']),
  createdAt: z.number(),
})
const KanbanIssueRelationListSchema = z.array(KanbanIssueRelationSchema).default([])
const SessionThinkingEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const SessionWorktreeHealthSchema = z.enum(['ok', 'missing', 'stale'])

const AgentSessionSchema = z
  .object({
    id: z.string(),
    issueId: z.string(),
    providerTargetId: z.string(),
    agentId: z.string().nullable(),
    chatSessionId: z.string().nullable(),
    status: z.enum(['created', 'active', 'completed', 'stopped', 'failed']),
    isCurrentDelegation: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough()
const IssueLinkedSessionSchema = z
  .object({
    id: z.string(),
    execution: z.union([
      z.object({ kind: z.string() }),
      z.object({
        kind: z.string(),
        hostId: z.string(),
        remoteSessionId: z.string(),
      }),
    ]),
    parentSessionId: z.string().nullable(),
    sideContextSource: z.enum(['provider-native', 'cradle-context']).nullable(),
    workspaceId: z.string().nullable(),
    title: z.string().nullable(),
    origin: z.string().default('manual'),
    providerTargetId: z.string().nullable(),
    agentId: z.string().nullable(),
    modelId: z.string().nullable(),
    thinkingEffort: SessionThinkingEffortSchema.nullable(),
    linkedIssueId: z.string().nullable(),
    sessionGroupId: z.string().nullable(),
    runtimeKind: z.string(),
    status: z.enum(['idle', 'streaming', 'error']),
    pinned: z.number(),
    archivedAt: z.number().nullable(),
    lastReadAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    latestUserMessageAt: z.number().nullable(),
    latestAssistantMessageAt: z.number().nullable(),
    unread: z.boolean(),
    isIsolated: z.boolean(),
    worktreeId: z.string().nullable(),
    worktreeBranch: z.string().nullable(),
    worktreePath: z.string().nullable(),
    worktreeHealth: SessionWorktreeHealthSchema.nullable(),
    pendingWorktreeId: z.string().nullable(),
    isolationBoundaryRequired: z.boolean(),
  })
  .passthrough()
const IssueSessionGroupSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    linkedIssueId: z.string().nullable(),
    status: z.enum(['active', 'archived']),
    configJson: z.string(),
    archivedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    sessionCount: z.number(),
    statusAggregate: z.enum(['idle', 'streaming', 'error']),
    latestActivityAt: z.number().nullable(),
  })
  .passthrough()
export type IssueSessionGroup = z.infer<typeof IssueSessionGroupSchema>
const LinkedIssueRefSchema = z
  .object({
    issueId: z.string().nullable(),
  })
  .nullable()

// ── Boards ────────────────────────────────────────────────────────────────────

export function useBoards(workspaceId?: string) {
  return useQuery({
    queryKey: kanbanKeys.boards(workspaceId),
    queryFn: async () => {
      const { data } = await getKanbanBoards({ query: { workspaceId } })
      return KanbanBoardListSchema.parse(data) satisfies KanbanBoard[]
    },
    ...queryRefreshPolicies.active,
  })
}

export function useAllBoards() {
  return useBoards()
}

export function useBoard(boardId: string) {
  const all = useBoards()
  return {
    ...all,
    data: all.data?.find(b => b.id === boardId),
  }
}

export function useCreateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateBoardInput) => {
      const { data, error } = await postKanbanBoards({ body: input })
      if (error || !data) {
        throw new Error('Failed to create board')
      }
      return KanbanBoardSchema.parse(data) satisfies KanbanBoard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

export function useUpdateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateBoardInput) => {
      const { data } = await patchKanbanBoardsById({ path: { id: vars.id }, body: vars.patch })
      return KanbanBoardSchema.parse(data) satisfies KanbanBoard
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteKanbanBoardsById({ path: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'boards'] }),
  })
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export function useStatuses(workspaceId: string) {
  return useQuery({
    queryKey: kanbanKeys.statuses(workspaceId),
    queryFn: async () => {
      const { data } = await getIssuesStatuses({ query: { workspaceId } })
      return KanbanStatusListSchema.parse(data) satisfies KanbanStatus[]
    },
    enabled: !!workspaceId,
    ...queryRefreshPolicies.active,
  })
}

export function useCreateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateStatusInput) => {
      const { data } = await postIssuesStatuses({ body: input })
      return KanbanStatusSchema.parse(data) satisfies KanbanStatus
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useUpdateStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateStatusInput) => {
      const { data } = await patchIssuesStatusesById({ path: { id: vars.id }, body: vars.patch })
      return KanbanStatusSchema.parse(data) satisfies KanbanStatus
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useReorderStatuses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: ReorderStatusesInput) => {
      await postIssuesStatusesReorder({ body: vars })
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) }),
  })
}

export function useDeleteStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: DeleteStatusInput) => {
      await deleteIssuesStatusesById({ path: { id: vars.id } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.statuses(vars.workspaceId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
    },
  })
}

// ── Milestones ────────────────────────────────────────────────────────────────

export function useMilestones(workspaceId: string) {
  return useQuery({
    queryKey: kanbanKeys.milestones(workspaceId),
    queryFn: async () => {
      const { data } = await getIssuesMilestones({ query: { workspaceId } })
      return KanbanMilestoneListSchema.parse(data) satisfies KanbanMilestone[]
    },
    enabled: !!workspaceId,
    ...queryRefreshPolicies.active,
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useCreateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateMilestoneInput) => {
      const { data } = await postIssuesMilestones({ body: input })
      return KanbanMilestoneSchema.parse(data) satisfies KanbanMilestone
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useUpdateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateMilestoneInput) => {
      const { data } = await patchIssuesMilestonesById({ path: { id: vars.id }, body: vars.patch })
      return KanbanMilestoneSchema.parse(data) satisfies KanbanMilestone
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useDeleteMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: DeleteMilestoneInput) => {
      await deleteIssuesMilestonesById({ path: { id: vars.id } })
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.milestones(vars.workspaceId) }),
  })
}

// ── Issues ────────────────────────────────────────────────────────────────────

export function useIssues(params: IssueFilterParams) {
  return useQuery({
    queryKey: kanbanKeys.issues(params),
    queryFn: async () => {
      const { data } = await getIssues({
        query: {
          workspaceId: params.workspaceId,
          milestoneId: params.milestoneId ?? undefined,
          parentIssueId: params.parentIssueId ?? undefined,
          priority: params.priority ?? undefined,
          statusId: params.statusId ?? undefined,
          labels: params.labels?.length ? params.labels.join(',') : undefined,
        },
      })
      return KanbanIssueListSchema.parse(data) satisfies KanbanIssue[]
    },
    enabled: !!params.workspaceId,
    ...queryRefreshPolicies.active,
  })
}

export function externalIssueToKanbanIssue(item: ExternalIssueItem): ExternalKanbanIssue {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    number: item.number,
    statusId: item.statusId,
    milestoneId: null,
    parentIssueId: null,
    title: item.title,
    description: item.body,
    priority: 'none',
    labels: item.labels,
    assigneeKind: item.assignees.length > 0 ? 'external' : null,
    assigneeId: item.assignees[0] ?? null,
    dueDate: null,
    createdByKind: 'system',
    createdById: item.sourceKey,
    sourceChatSessionId: null,
    delegateAgentId: null,
    delegateProviderTargetId: null,
    contextRefs: '[]',
    order: item.updatedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sourceKind: 'external',
    externalIssue: item,
  }
}

export function useExternalIssueItems(workspaceId: string) {
  return useQuery({
    queryKey: kanbanKeys.externalIssues(workspaceId),
    queryFn: async () => {
      const { data } = await getExternalIssueSourcesItems({
        query: { workspaceId },
      })
      return ExternalIssueItemListSchema.parse(data) satisfies ExternalIssueItem[]
    },
    enabled: !!workspaceId,
    ...queryRefreshPolicies.active,
  })
}

export function useBoardIssues(params: IssueFilterParams) {
  const nativeIssues = useIssues(params)
  const externalIssues = useExternalIssueItems(params.workspaceId)
  const externalCards = (externalIssues.data ?? [])
    .filter(item => item.syncStatus !== 'error')
    .map(externalIssueToKanbanIssue)

  return {
    ...nativeIssues,
    data: [...(nativeIssues.data ?? []), ...externalCards] satisfies KanbanBoardIssue[],
    isSuccess: nativeIssues.isSuccess && externalIssues.isSuccess,
    isLoading: nativeIssues.isLoading || externalIssues.isLoading,
    isPending: nativeIssues.isPending || externalIssues.isPending,
  }
}

export function useSearchIssues(query: string, limit = 20, enabled = true) {
  const trimmed = query.trim()

  return useQuery({
    queryKey: kanbanKeys.searchIssues(trimmed, limit),
    queryFn: async () => {
      const { data } = await getIssuesSearch({
        query: { q: trimmed, limit: String(limit) },
      })
      return KanbanIssueListSchema.parse(data) satisfies KanbanIssue[]
    },
    enabled: enabled && trimmed.length > 0,
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
  })
}

export function useIssue(id: string, enabled = true) {
  return useQuery({
    queryKey: kanbanKeys.issue(id),
    queryFn: async () => {
      const { data } = await getIssuesById({ path: { id } })
      return KanbanIssueSchema.parse(data) satisfies KanbanIssue
    },
    enabled: enabled && !!id,
    ...queryRefreshPolicies.interactive,
  })
}

export function useCreateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateIssueInput) => {
      const { data, error } = await postIssues({ body: input })
      if (error || !data) {
        throw new Error('Failed to create issue')
      }
      return KanbanIssueSchema.parse(data) satisfies KanbanIssue
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
    },
  })
}

export function useUpdateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: UpdateIssueInput) => {
      const { data } = await patchIssuesById({ path: { id: vars.id }, body: vars.patch })
      return KanbanIssueSchema.parse(data) satisfies KanbanIssue
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.id) })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.id) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.id) })
    },
  })
}

export function useBulkUpdateIssues() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: BulkUpdateIssuesInput) => {
      const { data } = await patchIssuesBulk({
        body: {
          issueIds: vars.ids,
          update: vars.patch,
        },
      })
      return z.object({ updated: z.number() }).parse(data)
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      for (const id of vars.ids) {
        qc.invalidateQueries({ queryKey: kanbanKeys.issue(id) })
        qc.invalidateQueries({ queryKey: kanbanKeys.activity(id) })
        qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(id) })
      }
    },
  })
}

export function usePatchIssueLabels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: PatchIssueLabelsInput) => {
      const rows = await Promise.all(
        vars.patches.map(async (patch) => {
          const { data } = await patchIssuesById({
            path: { id: patch.issueId },
            body: { labels: patch.labels },
          })
          return KanbanIssueSchema.parse(data) satisfies KanbanIssue
        }),
      )
      return rows
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      for (const patch of vars.patches) {
        qc.invalidateQueries({ queryKey: kanbanKeys.issue(patch.issueId) })
        qc.invalidateQueries({ queryKey: kanbanKeys.activity(patch.issueId) })
        qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(patch.issueId) })
      }
    },
  })
}

export function useMoveIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: MoveIssueInput) => {
      const { data } = await patchIssuesById({
        path: { id: vars.id },
        body: { statusId: vars.statusId },
      })
      return KanbanIssueSchema.parse(data) satisfies KanbanIssue
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.id) })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.id) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.id) })
    },
  })
}

export function useMoveExternalIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: MoveExternalIssueInput) => {
      const { data } = await patchExternalIssueSourcesItemsByIdStatus({
        path: { id: vars.id },
        body: { statusId: vars.statusId },
      })
      return ExternalIssueItemSchema.parse(data) satisfies ExternalIssueItem
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'externalIssues'] })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.externalIssues(_data.workspaceId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.id) })
    },
  })
}

export function useDeleteIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteIssuesById({ path: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'issues'] }),
  })
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function useIssueActivity(issueId: string, enabled = true) {
  return useQuery({
    queryKey: kanbanKeys.activity(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdActivity({ path: { id: issueId } })
      return KanbanIssueActivityListSchema.parse(data) satisfies KanbanIssueActivityItem[]
    },
    enabled: enabled && !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useIssueAgentSessions(issueId: string, enabled = true) {
  return useQuery({
    queryKey: kanbanKeys.agentSessions(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdAgentSessions({ path: { id: issueId } })
      return z.array(AgentSessionSchema).parse(data) satisfies AgentSession[]
    },
    enabled: enabled && !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useIssueLinkedSessions(issueId: string, enabled = true) {
  return useQuery({
    queryKey: kanbanKeys.linkedSessions(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdSessions({ path: { id: issueId } })
      return z.array(IssueLinkedSessionSchema).parse(data) satisfies IssueLinkedSession[]
    },
    enabled: enabled && !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useIssueSessionGroups(issueId: string, enabled = true) {
  return useQuery({
    queryKey: kanbanKeys.linkedSessionGroups(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdSessionGroups({ path: { id: issueId } })
      return z.array(IssueSessionGroupSchema).parse(data) satisfies IssueSessionGroup[]
    },
    enabled: enabled && !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useComments(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.comments(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdComments({ path: { id: issueId } })
      return KanbanIssueCommentListSchema.parse(data) satisfies KanbanIssueCommentView[]
    },
    enabled: !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useFieldChanges(issueId: string) {
  return useQuery({
    queryKey: kanbanKeys.fieldChanges(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdFieldChanges({ path: { id: issueId } })
      return KanbanIssueFieldChangeListSchema.parse(data) satisfies KanbanIssueFieldChangeView[]
    },
    enabled: !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useAddComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddCommentInput) => {
      const { data } = await postIssuesByIdComments({
        path: { id: input.issueId },
        body: { content: input.content },
      })
      return KanbanIssueCommentSchema.parse(data) satisfies KanbanIssueCommentView
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
    },
  })
}

export function useDeleteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: DeleteCommentInput) => deleteIssuesCommentsById({ path: { id: vars.id } }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
    },
  })
}

// ── Relations ─────────────────────────────────────────────────────────────────

export function useRelations(issueId: string, enabled = true) {
  return useQuery({
    queryKey: kanbanKeys.relations(issueId),
    queryFn: async () => {
      const { data } = await getIssuesByIdRelations({ path: { id: issueId } })
      return KanbanIssueRelationListSchema.parse(data) satisfies KanbanIssueRelation[]
    },
    enabled: enabled && !!issueId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useAddRelation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddRelationInput) => {
      const { data } = await postIssuesRelations({ body: input })
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.sourceIssueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.targetIssueId) })
    },
  })
}

export function useDeleteRelation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: DeleteRelationInput) => {
      await deleteIssuesRelationsById({ path: { id: vars.id } })
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: kanbanKeys.relations(vars.issueId) }),
  })
}

// ── Delegation ────────────────────────────────────────────────────────────────

export function useDelegateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      issueId: string
      agentId: string
      providerTargetId?: string | null
      runInIsolation?: boolean
    }) => {
      const { data } = await postIssuesByIdDelegation({
        path: { id: vars.issueId },
        body: {
          providerTargetId: vars.providerTargetId,
          agentId: vars.agentId,
          runInIsolation: vars.runInIsolation,
        },
      })
      return data === null ? null : (AgentSessionSchema.parse(data) satisfies AgentSession)
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.linkedSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.issueId) })
    },
  })
}

export function useRerunIssueAgentSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, agentSessionId: string }) => {
      const { data } = await postIssueAgentSessionsByAgentSessionIdRerun({
        path: { agentSessionId: vars.agentSessionId },
        body: {},
      })
      return AgentSessionSchema.parse(data) satisfies AgentSession
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.linkedSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.issueId) })
    },
  })
}

export function useUndelegateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string }) => {
      await deleteIssuesByIdDelegation({ path: { id: vars.issueId } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.agentSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.linkedSessions(vars.issueId) })
      qc.invalidateQueries({ queryKey: ['kanban', 'issues'] })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.comments(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.issueId) })
    },
  })
}

// ── Context Refs ──────────────────────────────────────────────────────────────

// eslint-disable-next-line unused-imports/no-unused-vars
function useAddContextRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, ref: string }) => {
      await postIssuesByIdContextRefs({ path: { id: vars.issueId }, body: { ref: vars.ref } })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.issueId) })
    },
  })
}

// eslint-disable-next-line unused-imports/no-unused-vars
function useRemoveContextRef() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { issueId: string, index: number }) => {
      await deleteIssuesByIdContextRefsByIndex({
        path: { id: vars.issueId, index: String(vars.index) },
      })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: kanbanKeys.issue(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.activity(vars.issueId) })
      qc.invalidateQueries({ queryKey: kanbanKeys.fieldChanges(vars.issueId) })
    },
  })
}

// ── Session ↔ Issue Link ──────────────────────────────────────────────────────

type LinkedIssueRef = {
  issueId: string | null
}

export function useLinkedIssue(chatSessionId: string | null) {
  return useQuery({
    queryKey: ['kanban', 'linkedIssue', chatSessionId] as const,
    queryFn: async () => {
      if (!chatSessionId) {
        return null
      }
      const { data } = await getSessionsByIdLinkedIssue({ path: { id: chatSessionId } })
      return LinkedIssueRefSchema.parse(data) satisfies LinkedIssueRef | null
    },
    enabled: !!chatSessionId,
    ...queryRefreshPolicies.interactive,
  })
}

export function useLinkIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { chatSessionId: string, issueId: string }) => {
      await postSessionsByIdLinkedIssue({
        path: { id: vars.chatSessionId },
        body: { issueId: vars.issueId },
      })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'linkedIssue', vars.chatSessionId] })
      qc.invalidateQueries({ queryKey: kanbanKeys.linkedSessions(vars.issueId) })
    },
  })
}

export function useUnlinkIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (chatSessionId: string) => {
      await deleteSessionsByIdLinkedIssue({ path: { id: chatSessionId } })
    },
    onSuccess: (_data, chatSessionId) => {
      qc.invalidateQueries({ queryKey: ['kanban', 'linkedIssue', chatSessionId] })
    },
  })
}
