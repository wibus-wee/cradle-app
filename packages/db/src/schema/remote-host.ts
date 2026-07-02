import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const remoteHosts = sqliteTable(
  'remote_hosts',
  {
    id: textPk(),
    displayName: text('display_name').notNull(),
    enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
    connectionConfigJson: text('connection_config_json').notNull().default('{}'),
    capabilitiesJson: text('capabilities_json').notNull().default('{}'),
    lastSeenAt: int('last_seen_at'),
    ...timestamps(),
  },
  table => ({
    byEnabled: index('remote_hosts_enabled_idx').on(table.enabled),
  }),
)

export type RemoteHost = typeof remoteHosts.$inferSelect
export type NewRemoteHost = typeof remoteHosts.$inferInsert
