import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { backendRuns } from './backend-control-plane'
import { messages, sessions } from './chat'
import { createdAt, textPk, timestamps, workspaces } from './shared'

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

/**
 * Normalized paths emitted by provider tool-input contracts. Unlike tool-event
 * summaries, these rows are suitable for an exact file-history lookup.
 */
export const recallFileTouches = sqliteTable(
  'recall_file_touches',
  {
    id: textPk(),
    toolEventId: text('tool_event_id')
      .notNull()
      .references(() => recallToolEvents.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    occurredAt: int('occurred_at').notNull(),
    ...createdAt(),
  },
  table => ({
    byToolEventPath: uniqueIndex('recall_file_touches_tool_event_path_unique').on(
      table.toolEventId,
      table.path,
    ),
    byWorkspacePathOccurred: index('recall_file_touches_workspace_path_occurred_at_idx').on(
      table.workspaceId,
      table.path,
      table.occurredAt,
    ),
    bySessionPathOccurred: index('recall_file_touches_session_path_occurred_at_idx').on(
      table.sessionId,
      table.path,
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

export const recallAttunements = sqliteTable(
  'recall_attunements',
  {
    id: textPk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    evidenceIdsJson: text('evidence_ids_json').notNull().default('[]'),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    archivedAt: int('archived_at'),
    ...timestamps(),
  },
  table => ({
    byWorkspaceUpdated: index('recall_attunements_workspace_updated_at_idx').on(
      table.workspaceId,
      table.updatedAt,
    ),
    bySession: index('recall_attunements_session_id_idx').on(table.sessionId),
    byStatus: index('recall_attunements_status_idx').on(table.workspaceId, table.status),
  }),
)

export const recallAttunementRequests = sqliteTable(
  'recall_attunement_requests',
  {
    id: textPk(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    operation: text('operation', { enum: ['remember', 'forget'] }).notNull(),
    content: text('content'),
    evidenceIdsJson: text('evidence_ids_json').notNull().default('[]'),
    attunementId: text('attunement_id').references(() => recallAttunements.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'approved', 'denied', 'executed'] })
      .notNull()
      .default('pending'),
    resolvedAt: int('resolved_at'),
    executedAt: int('executed_at'),
    ...timestamps(),
  },
  table => ({
    bySessionStatus: index('recall_attunement_requests_session_status_idx').on(
      table.sessionId,
      table.status,
      table.updatedAt,
    ),
    byWorkspaceStatus: index('recall_attunement_requests_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
  }),
)

export type RecallMessage = typeof recallMessages.$inferSelect
export type NewRecallMessage = typeof recallMessages.$inferInsert
export type RecallToolEvent = typeof recallToolEvents.$inferSelect
export type NewRecallToolEvent = typeof recallToolEvents.$inferInsert
export type RecallFileTouch = typeof recallFileTouches.$inferSelect
export type NewRecallFileTouch = typeof recallFileTouches.$inferInsert
export type RecallRun = typeof recallRuns.$inferSelect
export type NewRecallRun = typeof recallRuns.$inferInsert
export type RecallAttunement = typeof recallAttunements.$inferSelect
export type NewRecallAttunement = typeof recallAttunements.$inferInsert
export type RecallAttunementRequest = typeof recallAttunementRequests.$inferSelect
export type NewRecallAttunementRequest = typeof recallAttunementRequests.$inferInsert
