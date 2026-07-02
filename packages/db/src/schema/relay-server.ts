import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

/**
 * A reusable relay server that remote hosts can pair through.
 *
 * The relay itself owns only short-lived pairing/room state. This table is the
 * Cradle-side registry of relay servers a user has configured: a friendly name,
 * the public URL participating Cradle Server peers connect to, and whether it
 * is the default offered when pairing a new host.
 */
export const relayServers = sqliteTable(
  'relay_servers',
  {
    id: textPk(),
    displayName: text('display_name').notNull(),
    relayUrl: text('relay_url').notNull(),
    enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
    isDefault: int('is_default', { mode: 'boolean' }).notNull().default(false),
    ...timestamps(),
  },
  table => ({
    byDefault: index('relay_servers_default_idx').on(table.isDefault),
    byEnabled: index('relay_servers_enabled_idx').on(table.enabled),
  }),
)

export type RelayServer = typeof relayServers.$inferSelect
export type NewRelayServer = typeof relayServers.$inferInsert
