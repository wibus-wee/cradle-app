import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
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

export const remoteHostAgentdSessionLinks = sqliteTable(
  'remote_host_agentd_session_links',
  {
    id: textPk(),
    chatSessionId: text('chat_session_id')
      .notNull()
      .unique()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    remoteHostId: text('remote_host_id')
      .notNull()
      .references(() => remoteHosts.id, { onDelete: 'cascade' }),
    remoteAgentId: text('remote_agent_id').notNull(),
    remoteRuntimeKind: text('remote_runtime_kind').notNull(),
    daemonHostId: text('daemon_host_id'),
    providerSessionId: text('provider_session_id'),
    stateSnapshotJson: text('state_snapshot_json').notNull().default('{}'),
    ...timestamps(),
  },
  table => ({
    byRemoteHost: index('remote_host_agentd_session_links_host_idx').on(table.remoteHostId),
    byRemoteAgent: index('remote_host_agentd_session_links_agent_idx').on(table.remoteAgentId),
  }),
)

export type RemoteHost = typeof remoteHosts.$inferSelect
export type NewRemoteHost = typeof remoteHosts.$inferInsert
export type RemoteHostAgentdSessionLink = typeof remoteHostAgentdSessionLinks.$inferSelect
export type NewRemoteHostAgentdSessionLink = typeof remoteHostAgentdSessionLinks.$inferInsert
