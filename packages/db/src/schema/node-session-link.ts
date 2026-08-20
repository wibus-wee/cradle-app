import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { timestamps } from './shared'

/**
 * A controller-local projection of a session whose only execution authority
 * is the selected Fabric Node.
 */
export const nodeSessionLinks = sqliteTable(
  'node_session_links',
  {
    localSessionId: text('local_session_id')
      .primaryKey()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    remoteSessionId: text('remote_session_id').notNull(),
    remoteWorkspaceId: text('remote_workspace_id').notNull(),
    projectionKind: text('projection_kind', {
      enum: ['controller-created', 'discovered'],
    }).notNull().default('controller-created'),
    ...timestamps(),
  },
  table => ({
    byNode: index('node_session_links_node_id_idx').on(table.nodeId),
    uniqueRemoteSession: uniqueIndex('node_session_links_node_remote_session_unique').on(
      table.nodeId,
      table.remoteSessionId,
    ),
  }),
)

export type NodeSessionLink = typeof nodeSessionLinks.$inferSelect
export type NewNodeSessionLink = typeof nodeSessionLinks.$inferInsert
