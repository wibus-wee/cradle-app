import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { issueStatuses } from './issue'
import { textPk, timestamps, workspaces } from './shared'

export const externalIssueSources = sqliteTable('external_issue_sources', {
  id: textPk(),
  pluginName: text('plugin_name').notNull(),
  sourceId: text('source_id').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  registrationStatus: text('registration_status', {
    enum: ['registered', 'unregistered'],
  }).notNull().default('registered'),
  capabilitiesJson: text('capabilities_json').notNull().default('{}'),
  inventoryJson: text('inventory_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  lastSyncStatus: text('last_sync_status', {
    enum: ['never', 'ok', 'warning', 'error', 'rate-limited', 'not-modified'],
  }).notNull().default('never'),
  lastSyncMessage: text('last_sync_message'),
  lastSyncError: text('last_sync_error'),
  lastSyncAt: int('last_sync_at'),
  ...timestamps(),
}, table => ({
  byPluginSource: uniqueIndex('external_issue_sources_plugin_source_unique').on(table.pluginName, table.sourceId),
  byRegistrationStatus: index('external_issue_sources_registration_status_idx').on(table.registrationStatus),
}))

export const externalIssueSourceBindings = sqliteTable('external_issue_source_bindings', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceKey: text('source_key').notNull(),
  repositoryOwner: text('repository_owner').notNull(),
  repositoryName: text('repository_name').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  scheduleEnabled: int('schedule_enabled', { mode: 'boolean' }).notNull().default(false),
  refreshIntervalSeconds: int('refresh_interval_seconds').notNull().default(3600),
  lastRefreshStatus: text('last_refresh_status', {
    enum: ['never', 'ok', 'warning', 'error', 'rate-limited', 'not-modified'],
  }).notNull().default('never'),
  lastRefreshMessage: text('last_refresh_message'),
  lastRefreshError: text('last_refresh_error'),
  lastRefreshAt: int('last_refresh_at'),
  nextRefreshAfter: int('next_refresh_after'),
  ...timestamps(),
}, table => ({
  byWorkspaceSourceRepo: uniqueIndex('external_issue_bindings_workspace_source_repo_unique')
    .on(table.workspaceId, table.sourceKey, table.repositoryOwner, table.repositoryName),
  byWorkspace: index('external_issue_bindings_workspace_idx').on(table.workspaceId),
  bySource: index('external_issue_bindings_source_idx').on(table.sourceKey),
  bySchedule: index('external_issue_bindings_schedule_idx').on(table.scheduleEnabled, table.nextRefreshAfter),
}))

export const externalIssueRepositoryCursors = sqliteTable('external_issue_repository_cursors', {
  id: textPk(),
  sourceKey: text('source_key').notNull(),
  repositoryOwner: text('repository_owner').notNull(),
  repositoryName: text('repository_name').notNull(),
  etag: text('etag'),
  cursorJson: text('cursor_json').notNull().default('{}'),
  lastFetchStatus: text('last_fetch_status', {
    enum: ['never', 'ok', 'warning', 'error', 'rate-limited', 'not-modified'],
  }).notNull().default('never'),
  lastFetchMessage: text('last_fetch_message'),
  lastFetchError: text('last_fetch_error'),
  lastFetchedAt: int('last_fetched_at'),
  nextFetchAfter: int('next_fetch_after'),
  rateLimitResetAt: int('rate_limit_reset_at'),
  rateLimitRemaining: int('rate_limit_remaining'),
  ...timestamps(),
}, table => ({
  bySourceRepo: uniqueIndex('external_issue_repository_cursors_source_repo_unique')
    .on(table.sourceKey, table.repositoryOwner, table.repositoryName),
  byNextFetch: index('external_issue_repository_cursors_next_fetch_idx').on(table.nextFetchAfter),
}))

export const externalIssueItems = sqliteTable('external_issue_items', {
  id: textPk(),
  bindingId: text('binding_id')
    .notNull()
    .references(() => externalIssueSourceBindings.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  statusId: text('status_id').references(() => issueStatuses.id, { onDelete: 'set null' }),
  sourceKey: text('source_key').notNull(),
  externalId: text('external_id').notNull(),
  externalKey: text('external_key').notNull(),
  externalUrl: text('external_url'),
  repositoryOwner: text('repository_owner').notNull(),
  repositoryName: text('repository_name').notNull(),
  number: int('number').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  sourceState: text('source_state', { enum: ['open', 'closed'] }).notNull(),
  labelsJson: text('labels_json').notNull().default('[]'),
  assigneesJson: text('assignees_json').notNull().default('[]'),
  milestone: text('milestone'),
  sourceCreatedAt: text('source_created_at'),
  sourceUpdatedAt: text('source_updated_at'),
  sourceClosedAt: text('source_closed_at'),
  syncStatus: text('sync_status', {
    enum: ['active', 'missing', 'error'],
  }).notNull().default('active'),
  fingerprint: text('fingerprint').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  lastSeenAt: int('last_seen_at').notNull(),
  ...timestamps(),
}, table => ({
  byWorkspaceSourceExternal: uniqueIndex('external_issue_items_workspace_source_external_unique')
    .on(table.workspaceId, table.sourceKey, table.externalId),
  byWorkspaceSourceKey: uniqueIndex('external_issue_items_workspace_source_key_unique')
    .on(table.workspaceId, table.sourceKey, table.externalKey),
  byBinding: index('external_issue_items_binding_idx').on(table.bindingId),
  byWorkspace: index('external_issue_items_workspace_idx').on(table.workspaceId),
  byStatus: index('external_issue_items_status_idx').on(table.statusId),
  bySyncStatus: index('external_issue_items_sync_status_idx').on(table.syncStatus),
}))

export type ExternalIssueSource = typeof externalIssueSources.$inferSelect
export type NewExternalIssueSource = typeof externalIssueSources.$inferInsert
export type ExternalIssueSourceBinding = typeof externalIssueSourceBindings.$inferSelect
export type NewExternalIssueSourceBinding = typeof externalIssueSourceBindings.$inferInsert
export type ExternalIssueRepositoryCursor = typeof externalIssueRepositoryCursors.$inferSelect
export type NewExternalIssueRepositoryCursor = typeof externalIssueRepositoryCursors.$inferInsert
export type ExternalIssueItem = typeof externalIssueItems.$inferSelect
export type NewExternalIssueItem = typeof externalIssueItems.$inferInsert
