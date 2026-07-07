import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { index, int, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { agents } from './identity'
import { issues } from './issue'
import { providerTargets } from './provider-target'
import { createdAt, textPk, timestamps, workspaces } from './shared'
import { worktrees } from './worktree'

export const sessions = sqliteTable('sessions', {
  id: textPk(),
  parentSessionId: text('parent_session_id')
    .references((): AnySQLiteColumn => sessions.id, { onDelete: 'set null' }),
  sideContextSource: text('side_context_source', { enum: ['provider-native', 'cradle-context'] }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  titleSource: text('title_source', { enum: ['user', 'provider', 'initial'] }).notNull().default('initial'),
  origin: text('origin').notNull().default('manual'),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'restrict' }),
  runtimeKind: text('runtime_kind').notNull().default('standard'),
  agentId: text('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  configJson: text('config_json').notNull().default('{}'),
  linkedIssueId: text('linked_issue_id')
    .references(() => issues.id, { onDelete: 'set null' }),
  worktreeId: text('worktree_id')
    .references(() => worktrees.id, { onDelete: 'set null' }),
  pendingWorktreeId: text('pending_worktree_id')
    .references(() => worktrees.id, { onDelete: 'set null' }),
  pinned: int('pinned').notNull().default(0),
  archivedAt: int('archived_at'),
  lastReadAt: int('last_read_at'),
  ptyStartedAt: int('pty_started_at'),
  ...timestamps(),
}, table => ({
  byParentSession: index('sessions_parent_session_id_idx').on(table.parentSessionId),
  byWorkspace: index('sessions_workspace_id_idx').on(table.workspaceId),
  byOrigin: index('sessions_origin_idx').on(table.origin),
  byProviderTarget: index('sessions_provider_target_id_idx').on(table.providerTargetId),
  byLinkedIssue: index('sessions_linked_issue_id_idx').on(table.linkedIssueId),
  byWorktree: index('sessions_worktree_id_idx').on(table.worktreeId),
  byPendingWorktree: index('sessions_pending_worktree_id_idx').on(table.pendingWorktreeId),
  byArchived: index('sessions_archived_at_idx').on(table.archivedAt),
}))

export const messages = sqliteTable('messages', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  parentMessageId: text('parent_message_id'),
  parentToolCallId: text('parent_tool_call_id'),
  taskId: text('task_id'),
  depth: int('depth').notNull().default(0),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  status: text('status', {
    enum: ['streaming', 'complete', 'aborted', 'failed'],
  }).notNull().default('complete'),
  content: text('content').notNull(),
  messageJson: text('message_json').notNull(),
  errorText: text('error_text'),
  ...timestamps(),
}, table => ({
  bySession: index('messages_session_id_idx').on(table.sessionId),
  bySessionCreatedAt: index('messages_session_created_at_idx').on(table.sessionId, table.createdAt),
  byParentToolCall: index('messages_parent_tool_call_id_idx').on(table.parentToolCallId),
}))

export const usageLogs = sqliteTable('usage_logs', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => messages.id, { onDelete: 'set null' }),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  promptTokens: int('prompt_tokens').notNull().default(0),
  completionTokens: int('completion_tokens').notNull().default(0),
  totalTokens: int('total_tokens').notNull().default(0),
  ...createdAt(),
}, table => ({
  bySession: index('usage_logs_session_id_idx').on(table.sessionId),
  byMessage: index('usage_logs_message_id_idx').on(table.messageId),
  byProviderTarget: index('usage_logs_provider_target_id_idx').on(table.providerTargetId),
}))

export const stepUsage = sqliteTable('step_usage', {
  id: textPk(),
  runId: text('run_id').notNull(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  stepNumber: int('step_number').notNull(),
  stepType: text('step_type').notNull(),
  modelId: text('model_id'),
  promptTokens: int('prompt_tokens').notNull().default(0),
  completionTokens: int('completion_tokens').notNull().default(0),
  totalTokens: int('total_tokens').notNull().default(0),
  estimatedCostUsd: real('estimated_cost_usd').notNull().default(0),
  ...createdAt(),
}, table => ({
  byRun: index('step_usage_run_id_idx').on(table.runId),
  bySession: index('step_usage_session_id_idx').on(table.sessionId),
}))

export const chatSessionQueueItems = sqliteTable('chat_session_queue_items', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  mode: text('mode', { enum: ['queue'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'cancelled', 'completed', 'failed'],
  }).notNull().default('pending'),
  text: text('text').notNull(),
  filesJson: text('files_json').notNull().default('[]'),
  contextPartsJson: text('context_parts_json').notNull().default('[]'),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  thinkingEffort: text('thinking_effort', {
    enum: ['low', 'medium', 'high', 'xhigh'],
  }),
  permissionMode: text('permission_mode', {
    enum: ['bypassPermissions', 'plan'],
  }),
  runtimeAccessMode: text('runtime_access_mode', {
    enum: ['approval-required', 'full-access'],
  }),
  runtimeInteractionMode: text('runtime_interaction_mode', {
    enum: ['default', 'plan'],
  }),
  position: int('position').notNull(),
  sourceRunId: text('source_run_id'),
  startedRunId: text('started_run_id'),
  errorText: text('error_text'),
  ...timestamps(),
}, table => ({
  bySessionStatusPosition: index('chat_session_queue_items_session_status_position_idx')
    .on(table.sessionId, table.status, table.position),
  bySessionCreatedAt: index('chat_session_queue_items_session_created_at_idx')
    .on(table.sessionId, table.createdAt),
  byProviderTarget: index('chat_session_queue_items_provider_target_id_idx').on(table.providerTargetId),
  byStartedRun: index('chat_session_queue_items_started_run_id_idx').on(table.startedRunId),
}))

export const composerDrafts = sqliteTable('composer_drafts', {
  surfaceId: text('surface_id').primaryKey(),
  draftJson: text('draft_json').notNull().default('{}'),
  revision: int('revision').notNull().default(0),
  deletedAt: int('deleted_at'),
  ...timestamps(),
}, table => ({
  byUpdatedAt: index('composer_drafts_updated_at_idx').on(table.updatedAt),
  byDeletedAt: index('composer_drafts_deleted_at_idx').on(table.deletedAt),
}))

// Event Sourcing: append-only log for chat-runtime-owned session lifecycle facts.
// `messages`, `backend_runs`, `chat_session_queue_items`, and runtime-owned session fields
// are same-transaction projections. Session metadata creation, archive, and deletion remain
// owned by the session module. Payload JSON is versioned by chat-runtime-owned domain facts
// and hydrated through upcasters before projection.
export const sessionEvents = sqliteTable('session_events', {
  sequenceId: int('sequence_id').primaryKey({ autoIncrement: true }),
  aggregateId: text('aggregate_id').notNull(),
  aggregateType: text('aggregate_type').notNull().default('ChatSession'),
  version: int('version').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull().default('{}'),
  subjectRunId: text('subject_run_id').generatedAlwaysAs(
    sql`case
      when event_type = 'RunStarted' then json_extract(payload, '$.run.id')
      when event_type in ('RunCompleted', 'RunFailed', 'RunAborted') then json_extract(payload, '$.runId')
      else null
    end`,
    { mode: 'virtual' },
  ),
  occurredAt: int('occurred_at').notNull(),
}, table => ({
  byAggregateVersion: uniqueIndex('session_events_aggregate_version_unique').on(
    table.aggregateId,
    table.version,
  ),
  byAggregate: index('session_events_aggregate_id_idx').on(table.aggregateId),
  byEventType: index('session_events_event_type_idx').on(table.eventType),
  terminalFactByRun: uniqueIndex('session_events_terminal_fact_run_unique')
    .on(table.aggregateId, table.subjectRunId)
    .where(sql`${table.eventType} in ('RunCompleted', 'RunFailed', 'RunAborted') and ${table.subjectRunId} is not null`),
}))

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type UsageLog = typeof usageLogs.$inferSelect
export type NewUsageLog = typeof usageLogs.$inferInsert
export type StepUsageRow = typeof stepUsage.$inferSelect
export type NewStepUsageRow = typeof stepUsage.$inferInsert
export type ChatSessionQueueItem = typeof chatSessionQueueItems.$inferSelect
export type NewChatSessionQueueItem = typeof chatSessionQueueItems.$inferInsert
export type ComposerDraftRow = typeof composerDrafts.$inferSelect
export type NewComposerDraftRow = typeof composerDrafts.$inferInsert
export type SessionEvent = typeof sessionEvents.$inferSelect
export type NewSessionEvent = typeof sessionEvents.$inferInsert
