import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { remoteHosts } from './remote-host'
import { timestamps } from './shared'

export const remoteSessionLinks = sqliteTable(
  'remote_session_links',
  {
    localSessionId: text('local_session_id')
      .primaryKey()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    hostId: text('host_id')
      .notNull()
      .references(() => remoteHosts.id, { onDelete: 'cascade' }),
    remoteSessionId: text('remote_session_id').notNull(),
    remoteWorkspaceId: text('remote_workspace_id').notNull(),
    ...timestamps(),
  },
  table => ({
    byHost: index('remote_session_links_host_id_idx').on(table.hostId),
    uniqueRemoteSession: uniqueIndex('remote_session_links_host_remote_session_unique').on(
      table.hostId,
      table.remoteSessionId,
    ),
  }),
)

export type RemoteSessionLink = typeof remoteSessionLinks.$inferSelect
export type NewRemoteSessionLink = typeof remoteSessionLinks.$inferInsert
