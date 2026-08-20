import { sql } from 'drizzle-orm'
import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { issues } from './issue'
import { textPk, timestamps } from './shared'

export const works = sqliteTable('works', {
  id: textPk(),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  linkedIssueId: text('linked_issue_id')
    .references(() => issues.id, { onDelete: 'set null' }),
  handoffTitle: text('handoff_title'),
  handoffSummary: text('handoff_summary'),
  handoffTestPlan: text('handoff_test_plan'),
  preparedAt: int('prepared_at'),
  lastSubmittedAt: int('last_submitted_at'),
  closedAt: int('closed_at'),
  archivedAt: int('archived_at'),
  ...timestamps(),
}, table => ({
  byLinkedIssue: index('works_linked_issue_id_idx').on(table.linkedIssueId),
  byArchived: index('works_archived_at_idx').on(table.archivedAt),
  byUpdated: index('works_updated_at_idx').on(table.updatedAt),
}))

export const workThreads = sqliteTable('work_threads', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workId: text('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['primary', 'supporting'] }).notNull(),
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
}, table => ({
  byWork: index('work_threads_work_id_idx').on(table.workId),
  primaryByWork: uniqueIndex('work_threads_primary_work_unique')
    .on(table.workId)
    .where(sql`${table.role} = 'primary'`),
}))

export type Work = typeof works.$inferSelect
export type NewWork = typeof works.$inferInsert
export type WorkThread = typeof workThreads.$inferSelect
export type NewWorkThread = typeof workThreads.$inferInsert
