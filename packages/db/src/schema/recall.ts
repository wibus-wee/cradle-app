import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { backendRuns } from './backend-control-plane'
import { messages, sessions } from './chat'
import { createdAt, textPk, workspaces } from './shared'

/**
 * Recall owns derived, disposable evidence projections. Source messages and run
 * snapshots remain authoritative in their respective domain tables.
 */
export const recallMessages = sqliteTable(
  'recall_messages',
  {
    messageId: text('message_id')
      .primaryKey()
      .references(() => messages.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    status: text('status', { enum: ['complete', 'aborted', 'failed'] }).notNull(),
    isSidechain: int('is_sidechain').notNull().default(0),
    isMeta: int('is_meta').notNull().default(0),
    excerpt: text('excerpt').notNull(),
    occurredAt: int('occurred_at').notNull(),
  },
  table => ({
    bySessionOccurred: index('recall_messages_session_occurred_at_idx').on(
      table.sessionId,
      table.occurredAt,
    ),
    byWorkspaceOccurred: index('recall_messages_workspace_occurred_at_idx').on(
      table.workspaceId,
      table.occurredAt,
    ),
    byMessage: uniqueIndex('recall_messages_message_id_unique').on(table.messageId),
  }),
)

export const recallToolEvents = sqliteTable(
  'recall_tool_events',
  {
    id: textPk(),
    runId: text('run_id').references(() => backendRuns.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceEventId: text('source_event_id').notNull(),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    phase: text('phase').notNull(),
    isFailure: int('is_failure').notNull().default(0),
    summary: text('summary').notNull(),
    occurredAt: int('occurred_at').notNull(),
    ...createdAt(),
  },
  table => ({
    bySource: uniqueIndex('recall_tool_events_source_event_unique').on(table.sourceEventId),
    bySessionOccurred: index('recall_tool_events_session_occurred_at_idx').on(
      table.sessionId,
      table.occurredAt,
    ),
    byWorkspaceOccurred: index('recall_tool_events_workspace_occurred_at_idx').on(
      table.workspaceId,
      table.occurredAt,
    ),
    byFailure: index('recall_tool_events_failure_idx').on(
      table.workspaceId,
      table.isFailure,
      table.occurredAt,
    ),
    byToolName: index('recall_tool_events_tool_name_idx').on(
      table.workspaceId,
      table.toolName,
      table.occurredAt,
    ),
  }),
)

export const recallRuns = sqliteTable(
  'recall_runs',
  {
    runId: text('run_id')
      .primaryKey()
      .references(() => backendRuns.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['streaming', 'complete', 'aborted', 'failed'] }).notNull(),
    stopReason: text('stop_reason'),
    errorText: text('error_text'),
    startedAt: int('started_at').notNull(),
    finishedAt: int('finished_at'),
  },
  table => ({
    bySessionStarted: index('recall_runs_session_started_at_idx').on(
      table.sessionId,
      table.startedAt,
    ),
    byWorkspaceStarted: index('recall_runs_workspace_started_at_idx').on(
      table.workspaceId,
      table.startedAt,
    ),
    byStatus: index('recall_runs_status_idx').on(table.workspaceId, table.status, table.startedAt),
  }),
)

export type RecallMessage = typeof recallMessages.$inferSelect
export type NewRecallMessage = typeof recallMessages.$inferInsert
export type RecallToolEvent = typeof recallToolEvents.$inferSelect
export type NewRecallToolEvent = typeof recallToolEvents.$inferInsert
export type RecallRun = typeof recallRuns.$inferSelect
export type NewRecallRun = typeof recallRuns.$inferInsert
