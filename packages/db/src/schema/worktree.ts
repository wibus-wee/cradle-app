import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

export const worktrees = sqliteTable('worktrees', {
  id: textPk(),
  sourceWorkspaceId: text('source_workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  branch: text('branch').notNull(),
  baseRef: text('base_ref').notNull(),
  status: text('status', { enum: ['active', 'merged', 'abandoned'] }).notNull().default('active'),
  createdBySessionId: text('created_by_session_id'),
  ...timestamps(),
}, table => ({
  bySourceWorkspace: index('worktrees_source_workspace_id_idx').on(table.sourceWorkspaceId),
  byStatus: index('worktrees_status_idx').on(table.status),
  byName: index('worktrees_source_workspace_name_idx').on(table.sourceWorkspaceId, table.name),
}))

export type Worktree = typeof worktrees.$inferSelect
export type NewWorktree = typeof worktrees.$inferInsert
