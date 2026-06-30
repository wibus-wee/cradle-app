import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { backendRuns } from './backend-control-plane'
import { messages, sessions } from './chat'
import { textPk } from './shared'

export const observabilityEvents = sqliteTable('observability_events', {
  id: textPk(),
  schemaVersion: int('schema_version').notNull(),
  source: text('source').notNull(),
  code: text('code').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  message: text('message').notNull(),
  attrsJson: text('attrs_json'),
  chatSessionId: text('chat_session_id')
    .references(() => sessions.id, { onDelete: 'set null' }),
  runId: text('run_id')
    .references(() => backendRuns.id, { onDelete: 'set null' }),
  messageId: text('message_id')
    .references(() => messages.id, { onDelete: 'set null' }),
  traceId: text('trace_id'),
  dedupeKey: text('dedupe_key'),
  parentEventId: text('parent_event_id')
    .references(() => observabilityEvents.id, { onDelete: 'set null' }),
  occurredAt: int('occurred_at').notNull(),
  recordedAt: int('recorded_at').notNull(),
}, table => ({
  byRecordedAt: index('observability_events_recorded_at_idx').on(table.recordedAt),
  byCode: index('observability_events_code_idx').on(table.code),
  byRun: index('observability_events_run_id_idx').on(table.runId),
}))

export const observabilityIncidents = sqliteTable('observability_incidents', {
  id: textPk(),
  dedupeKey: text('dedupe_key').notNull(),
  code: text('code').notNull(),
  severity: text('severity').notNull(),
  status: text('status').notNull(),
  source: text('source').notNull(),
  message: text('message').notNull(),
  chatSessionId: text('chat_session_id')
    .references(() => sessions.id, { onDelete: 'set null' }),
  runId: text('run_id')
    .references(() => backendRuns.id, { onDelete: 'set null' }),
  messageId: text('message_id')
    .references(() => messages.id, { onDelete: 'set null' }),
  firstOccurredAt: int('first_occurred_at').notNull(),
  lastOccurredAt: int('last_occurred_at').notNull(),
  lastRecordedAt: int('last_recorded_at').notNull(),
  count: int('count').notNull().default(1),
  lastEventId: text('last_event_id')
    .references(() => observabilityEvents.id, { onDelete: 'set null' }),
  attrsJson: text('attrs_json'),
}, table => ({
  byDedupeKey: uniqueIndex('observability_incidents_dedupe_key_unique').on(table.dedupeKey),
}))

export type ObservabilityEventRow = typeof observabilityEvents.$inferSelect
export type NewObservabilityEventRow = typeof observabilityEvents.$inferInsert
export type ObservabilityIncidentRow = typeof observabilityIncidents.$inferSelect
export type NewObservabilityIncidentRow = typeof observabilityIncidents.$inferInsert
