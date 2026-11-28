import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { textPk, timestamps, workspaces } from './shared'

export const externalSessionImports = sqliteTable('external_session_imports', {
  id: textPk(),
  sourceHostId: text('source_host_id').notNull(),
  sourceApp: text('source_app', { enum: ['claude', 'codex', 'kimi', 'opencode'] }).notNull(),
  externalSessionId: text('external_session_id').notNull(),
  sourcePath: text('source_path'),
  sourceWorkspacePath: text('source_workspace_path').notNull(),
  sourceRevision: text('source_revision').notNull(),
  contentHash: text('content_hash').notNull(),
  sourceGitIdentityJson: text('source_git_identity_json').notNull().default('{}'),
  bundlePath: text('bundle_path'),
  bundleManifestJson: text('bundle_manifest_json').notNull().default('{}'),
  parserVersion: int('parser_version').notNull().default(0),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  fidelityJson: text('fidelity_json').notNull().default('{}'),
  checkpointJson: text('checkpoint_json').notNull().default('{}'),
  status: text('status', {
    enum: ['imported', 'update-available', 'error'],
  }).notNull().default('imported'),
  statusReason: text('status_reason'),
  importedAt: int('imported_at').notNull(),
  lastSyncedAt: int('last_synced_at').notNull(),
  ...timestamps(),
}, table => ({
  bySourceIdentity: uniqueIndex('external_session_imports_source_identity_unique').on(
    table.sourceHostId,
    table.sourceApp,
    table.externalSessionId,
  ),
  byWorkspace: index('external_session_imports_workspace_id_idx').on(table.workspaceId),
  bySession: uniqueIndex('external_session_imports_session_id_unique').on(table.sessionId),
  byStatus: index('external_session_imports_status_idx').on(table.status),
}))

export type ExternalSessionImport = typeof externalSessionImports.$inferSelect
export type NewExternalSessionImport = typeof externalSessionImports.$inferInsert
