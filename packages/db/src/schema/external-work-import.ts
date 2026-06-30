import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { messages, sessions } from './chat'
import { textPk, timestamps, workspaces } from './shared'

export const externalWorkImportItems = sqliteTable('external_work_import_items', {
  id: textPk(),
  sourceApp: text('source_app', {
    enum: ['claude', 'codex', 'cursor', 'windsurf', 'gemini', 'unknown'],
  }).notNull(),
  sourceScope: text('source_scope', {
    enum: ['server', 'electron-upload'],
  }).notNull(),
  sourceKind: text('source_kind', {
    enum: ['settings', 'project', 'session', 'instruction', 'mcp', 'command', 'hook', 'skill', 'plugin', 'subagent'],
  }).notNull(),
  sourcePath: text('source_path'),
  externalId: text('external_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
  payloadJson: text('payload_json').notNull().default('{}'),
  status: text('status', {
    enum: ['imported', 'skipped', 'error'],
  }).notNull().default('imported'),
  statusReason: text('status_reason'),
  importedAt: int('imported_at').notNull(),
  ...timestamps(),
}, table => ({
  byFingerprint: uniqueIndex('external_work_import_items_fingerprint_unique').on(table.fingerprint),
  bySource: index('external_work_import_items_source_idx').on(table.sourceApp, table.sourceKind),
  byWorkspace: index('external_work_import_items_workspace_id_idx').on(table.workspaceId),
  bySession: index('external_work_import_items_session_id_idx').on(table.sessionId),
}))

export type ExternalWorkImportItem = typeof externalWorkImportItems.$inferSelect
export type NewExternalWorkImportItem = typeof externalWorkImportItems.$inferInsert
