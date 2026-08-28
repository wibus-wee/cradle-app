/**
 * Unified trust grant store.
 *
 * Records an explicit operator decision to trust a subject for execution.
 * Used by plugin loading (external local packages) and worktree setup hooks;
 * future trust-gated surfaces should add a new `subjectType` value rather
 * than creating a separate table.
 */
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const trustGrants = sqliteTable('trust_grants', {
  id: textPk(),
  /** Discriminates the kind of trust subject. */
  subjectType: text('subject_type', { enum: ['plugin_package', 'plugin_permission', 'worktree_setup_hook'] }).notNull(),
  /** Identifier meaningful to the subject type: plugin name, encoded plugin permission, or workspace id. */
  subjectKey: text('subject_key').notNull(),
  /**
   * Package checksum for `plugin_package`; `'*'` sentinel for
   * `worktree_setup_hook` (no checksum applies, but the sentinel keeps the
   * unique index effective so at most one grant exists per workspace).
   */
  checksum: text('checksum').notNull(),
  reason: text('reason'),
  ...timestamps(),
}, table => ({
  bySubjectType: index('trust_grants_subject_type_idx').on(table.subjectType),
  bySubjectKey: index('trust_grants_subject_key_idx').on(table.subjectKey),
  unique: uniqueIndex('trust_grants_unique').on(table.subjectType, table.subjectKey, table.checksum),
}))

export type TrustGrant = typeof trustGrants.$inferSelect
export type NewTrustGrant = typeof trustGrants.$inferInsert
