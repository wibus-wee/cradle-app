import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { timestamps } from './shared'
import { works } from './work'

/**
 * A controller-local Work projection whose execution authority and worktree
 * lifecycle live on the selected Fabric Node.
 */
export const nodeWorkLinks = sqliteTable(
  'node_work_links',
  {
    localWorkId: text('local_work_id')
      .primaryKey()
      .references(() => works.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    remoteWorkId: text('remote_work_id').notNull(),
    remoteWorkspaceId: text('remote_workspace_id').notNull(),
    ...timestamps(),
  },
  table => ({
    byNode: index('node_work_links_node_id_idx').on(table.nodeId),
    uniqueRemoteWork: uniqueIndex('node_work_links_node_remote_work_unique').on(
      table.nodeId,
      table.remoteWorkId,
    ),
  }),
)

export type NodeWorkLink = typeof nodeWorkLinks.$inferSelect
export type NewNodeWorkLink = typeof nodeWorkLinks.$inferInsert
