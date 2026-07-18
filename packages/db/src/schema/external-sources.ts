import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const externalProviderSources = sqliteTable('external_provider_sources', {
  id: textPk(),
  pluginName: text('plugin_name').notNull(),
  sourceId: text('source_id').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  capabilitiesJson: text('capabilities_json').notNull().default('{}'),
  inventoryJson: text('inventory_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  lastSyncStatus: text('last_sync_status', {
    enum: ['never', 'ok', 'warning', 'error'],
  }).notNull().default('never'),
  lastSyncMessage: text('last_sync_message'),
  lastSyncError: text('last_sync_error'),
  lastSyncAt: int('last_sync_at'),
  ...timestamps(),
}, table => ({
  byPluginSource: uniqueIndex('external_provider_sources_plugin_source_unique').on(table.pluginName, table.sourceId),
}))

export const externalProviderRecords = sqliteTable('external_provider_records', {
  id: textPk(),
  sourceKey: text('source_key').notNull(),
  externalId: text('external_id').notNull(),
  app: text('app').notNull(),
  name: text('name').notNull(),
  providerKind: text('provider_kind', {
    enum: ['openai-compatible', 'anthropic', 'universal', 'cli-tool'],
  }).notNull(),
  status: text('status', {
    enum: ['active', 'stale', 'missing', 'unsupported', 'error'],
  }).notNull().default('active'),
  fingerprint: text('fingerprint').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  lastSeenAt: int('last_seen_at').notNull(),
  ...timestamps(),
}, table => ({
  bySourceExternal: uniqueIndex('external_provider_records_source_external_unique').on(table.sourceKey, table.externalId),
  bySource: index('external_provider_records_source_idx').on(table.sourceKey),
  byStatus: index('external_provider_records_status_idx').on(table.status),
}))

export type ExternalProviderSource = typeof externalProviderSources.$inferSelect
export type NewExternalProviderSource = typeof externalProviderSources.$inferInsert
export type ExternalProviderRecord = typeof externalProviderRecords.$inferSelect
export type NewExternalProviderRecord = typeof externalProviderRecords.$inferInsert
