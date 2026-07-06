/* Defines Cradle-owned persistent storage for plugin infrastructure. */
import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const pluginStorageEntries = sqliteTable('plugin_storage_entries', {
  id: textPk(),
  pluginName: text('plugin_name').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  ...timestamps(),
}, table => ({
  byPluginKey: uniqueIndex('plugin_storage_entries_plugin_key_unique').on(table.pluginName, table.key),
  byPlugin: index('plugin_storage_entries_plugin_idx').on(table.pluginName),
}))

export const pluginActivationPolicies = sqliteTable('plugin_activation_policies', {
  id: textPk(),
  pluginName: text('plugin_name').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  reason: text('reason'),
  ...timestamps(),
}, table => ({
  byPlugin: uniqueIndex('plugin_activation_policies_plugin_unique').on(table.pluginName),
}))

export const pluginSources = sqliteTable('plugin_sources', {
  id: textPk(),
  kind: text('kind', { enum: ['localPath', 'git', 'npm'] }).notNull(),
  location: text('location').notNull(),
  ref: text('ref'),
  subPath: text('sub_path'),
  label: text('label'),
  addedReason: text('added_reason').notNull(),
  ...timestamps(),
}, table => ({
  byKindLocation: index('plugin_sources_kind_location_idx').on(table.kind, table.location),
}))

export type PluginStorageEntry = typeof pluginStorageEntries.$inferSelect
export type NewPluginStorageEntry = typeof pluginStorageEntries.$inferInsert
export type PluginActivationPolicy = typeof pluginActivationPolicies.$inferSelect
export type NewPluginActivationPolicy = typeof pluginActivationPolicies.$inferInsert
export type PluginSource = typeof pluginSources.$inferSelect
export type NewPluginSource = typeof pluginSources.$inferInsert
