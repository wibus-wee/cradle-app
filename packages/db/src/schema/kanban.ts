import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

export const kanbanBoards = sqliteTable('kanban_boards', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filterConfig: text('filter_config'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('kanban_boards_workspace_id_idx').on(table.workspaceId),
}))

export type KanbanBoard = typeof kanbanBoards.$inferSelect
