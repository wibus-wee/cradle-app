import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { textPk, timestamps, workspaces } from './shared'

export const turnCheckpoints = sqliteTable('turn_checkpoints', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull(),
  assistantMessageId: text('assistant_message_id'),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  workspacePath: text('workspace_path').notNull(),
  startRef: text('start_ref').notNull(),
  endRef: text('end_ref'),
  status: text('status', { enum: ['capturing', 'completed', 'failed'] })
    .notNull()
    .default('capturing'),
  changedFiles: int('changed_files').notNull().default(0),
  additions: int('additions').notNull().default(0),
  deletions: int('deletions').notNull().default(0),
  errorText: text('error_text'),
  completedAt: int('completed_at'),
  restoredAt: int('restored_at'),
  ...timestamps(),
}, table => ({
  run: uniqueIndex('turn_checkpoints_session_run_unique').on(table.sessionId, table.runId),
  bySessionCreated: index('turn_checkpoints_session_created_idx').on(table.sessionId, table.createdAt),
  bySessionStatus: index('turn_checkpoints_session_status_idx').on(table.sessionId, table.status),
}))

export type TurnCheckpoint = typeof turnCheckpoints.$inferSelect
export type NewTurnCheckpoint = typeof turnCheckpoints.$inferInsert
