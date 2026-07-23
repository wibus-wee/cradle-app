import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { createdAt, textPk, workspaces } from './shared'

export const sessionAwaits = sqliteTable('session_awaits', {
  id: textPk(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  filterJson: text('filter_json').notNull(),
  status: text('status', {
    enum: ['pending', 'triggered', 'expired', 'cancelled', 'failed'],
  }).notNull().default('pending'),
  reason: text('reason'),
  resumeText: text('resume_text'),
  resumePayloadJson: text('resume_payload_json'),
  failureKind: text('failure_kind', {
    enum: ['source', 'delivery'],
  }),
  bypassedChecksJson: text('bypassed_checks_json'),
  ...createdAt(),
  triggeredAt: int('triggered_at'),
  expiresAt: int('expires_at'),
  fireAt: int('fire_at'),
  lastCheckedAt: int('last_checked_at'),
  lastErrorText: text('last_error_text'),
  consecutiveErrorCount: int('consecutive_error_count').notNull().default(0),
}, table => ([
  index('idx_session_awaits_status').on(table.status),
  index('idx_session_awaits_session').on(table.chatSessionId),
]))

export const githubApiCache = sqliteTable('github_api_cache', {
  cacheKey: text('cache_key').primaryKey(),
  dataJson: text('data_json').notNull(),
  etag: text('etag'),
  fetchedAt: int('fetched_at').notNull().default(0),
})

export const awaitBypassRules = sqliteTable('await_bypass_rules', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  checkPattern: text('check_pattern').notNull(),
  enabled: int('enabled').notNull().default(1),
  ...createdAt(),
}, table => ([
  index('idx_await_bypass_rules_workspace').on(table.workspaceId),
]))
