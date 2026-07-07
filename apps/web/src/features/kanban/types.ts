import type {
  GetExternalIssueSourcesItemsResponse,
  GetIssuesByIdActivityResponse,
  GetIssuesByIdAgentSessionsResponse,
  GetIssuesByIdCommentsResponse,
  GetIssuesByIdFieldChangesResponse,
  GetIssuesByIdRelationsResponse,
  GetIssuesByIdSessionsResponse,
  GetIssuesMilestonesResponse,
  GetIssuesResponse,
  GetIssuesStatusesResponse,
  GetKanbanBoardsResponse,
} from '~/api-gen/types.gen'

export type KanbanBoard = GetKanbanBoardsResponse[number]
export type KanbanIssue = GetIssuesResponse[number]
export type ExternalIssueItem = GetExternalIssueSourcesItemsResponse[number]
export type ExternalKanbanIssue = KanbanIssue & {
  sourceKind: 'external'
  externalIssue: ExternalIssueItem
}
export type KanbanBoardIssue = KanbanIssue | ExternalKanbanIssue
export type KanbanMilestone = GetIssuesMilestonesResponse[number]
export type KanbanIssueRelation = GetIssuesByIdRelationsResponse[number]
export type KanbanIssueCommentView = GetIssuesByIdCommentsResponse[number]
export type KanbanIssueFieldChangeView = GetIssuesByIdFieldChangesResponse[number]
export type AgentSession = GetIssuesByIdAgentSessionsResponse[number]
export type IssueLinkedSession = GetIssuesByIdSessionsResponse[number]

export function isExternalKanbanIssue(issue: KanbanBoardIssue | null | undefined): issue is ExternalKanbanIssue {
  return (issue as Partial<ExternalKanbanIssue> | null | undefined)?.sourceKind === 'external'
}

export type KanbanStatus = Omit<GetIssuesStatusesResponse[number], 'category'> & {
  category: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
}

export type IssueCommentAuthor = KanbanIssueCommentView['author']
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

export type IssueActivityValue
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

export type KanbanIssueActivityItem = Omit<GetIssuesByIdActivityResponse[number], 'comment' | 'fieldChange'> & {
  comment: {
    content: string
    systemKind: 'delegated' | 'system' | 'undelegated' | null
  } | null
  fieldChange: {
    action: IssueActivityAction
    field: IssueActivityField | null
    fromValue: IssueActivityValue | null
    toValue: IssueActivityValue | null
  } | null
}
