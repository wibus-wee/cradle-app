import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { agents } from './identity'
import { providerTargets } from './provider-target'
import { createdAt, textPk, timestamps, workspaces } from './shared'

export const issueStatuses = sqliteTable('issue_statuses', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  category: text('category', { enum: ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'] }).notNull().default('unstarted'),
  order: int('order').notNull().default(0),
  ...createdAt(),
}, table => ({
  byWorkspace: index('issue_statuses_workspace_id_idx').on(table.workspaceId),
  byWorkspaceName: uniqueIndex('issue_statuses_workspace_name_unique').on(table.workspaceId, table.name),
}))

export const issueMilestones = sqliteTable('issue_milestones', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  dueDate: int('due_date'),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('issue_milestones_workspace_id_idx').on(table.workspaceId),
}))

export const issues = sqliteTable('issues', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  number: int('number').notNull(),
  statusId: text('status_id').references(() => issueStatuses.id, { onDelete: 'set null' }),
  milestoneId: text('milestone_id').references(() => issueMilestones.id, { onDelete: 'set null' }),
  parentIssueId: text('parent_issue_id')
    .references((): AnySQLiteColumn => issues.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority', {
    enum: ['none', 'low', 'medium', 'high', 'urgent'],
  }).notNull().default('none'),
  labels: text('labels').notNull().default('[]'),
  assigneeKind: text('assignee_kind'),
  assigneeId: text('assignee_id'),
  dueDate: int('due_date'),
  createdByKind: text('created_by_kind', { enum: ['user', 'agent', 'system', 'provider-target'] }).notNull().default('user'),
  createdById: text('created_by_id').notNull().default('__self__'),
  sourceChatSessionId: text('source_chat_session_id'),
  delegateAgentId: text('delegate_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  delegateProviderTargetId: text('delegate_provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  contextRefs: text('context_refs').notNull().default('[]'),
  order: int('order').notNull().default(0),
  ...timestamps(),
}, table => ({
  byWorkspace: index('issues_workspace_id_idx').on(table.workspaceId),
  byWorkspaceNumber: uniqueIndex('issues_workspace_number_unique').on(table.workspaceId, table.number),
  byStatus: index('issues_status_id_idx').on(table.statusId),
  byMilestone: index('issues_milestone_id_idx').on(table.milestoneId),
  byParent: index('issues_parent_issue_id_idx').on(table.parentIssueId),
  byDelegateAgent: index('issues_delegate_agent_id_idx').on(table.delegateAgentId),
  byDelegateProviderTarget: index('issues_delegate_provider_target_id_idx').on(table.delegateProviderTargetId),
}))

export const issueComments = sqliteTable('issue_comments', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  authorKind: text('author_kind', {
    enum: ['user', 'agent', 'provider-target', 'system', 'system.delegated', 'system.undelegated'],
  }).notNull().default('user'),
  authorId: text('author_id'),
  sourceChatSessionId: text('source_chat_session_id'),
  agentActivityId: text('agent_activity_id'),
  ...createdAt(),
}, table => ({
  byIssue: index('issue_comments_issue_id_idx').on(table.issueId),
}))

export const issueRelations = sqliteTable('issue_relations', {
  id: textPk(),
  sourceIssueId: text('source_issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  targetIssueId: text('target_issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['blocks', 'duplicates', 'relates_to'] }).notNull(),
  ...createdAt(),
}, table => ({
  bySource: index('issue_relations_source_issue_id_idx').on(table.sourceIssueId),
  byTarget: index('issue_relations_target_issue_id_idx').on(table.targetIssueId),
  byPairType: uniqueIndex('issue_relations_pair_type_unique')
    .on(table.sourceIssueId, table.targetIssueId, table.type),
}))

export const issueFieldChanges = sqliteTable('issue_field_changes', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  field: text('field').notNull(),
  fromValue: text('from_value'),
  toValue: text('to_value'),
  actorKind: text('actor_kind', { enum: ['user', 'agent', 'provider-target', 'system'] }).notNull().default('user'),
  actorId: text('actor_id'),
  sourceChatSessionId: text('source_chat_session_id'),
  ...createdAt(),
}, table => ({
  byIssue: index('issue_field_changes_issue_id_idx').on(table.issueId),
}))

export type IssueStatus = typeof issueStatuses.$inferSelect
export type IssueMilestone = typeof issueMilestones.$inferSelect
export type Issue = typeof issues.$inferSelect
export type IssueComment = typeof issueComments.$inferSelect
export type IssueRelation = typeof issueRelations.$inferSelect
export type IssueFieldChange = typeof issueFieldChanges.$inferSelect
