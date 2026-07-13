import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { backendRuns } from './backend-control-plane'
import { sessions } from './chat'
import { agents } from './identity'
import { textPk, timestamps, workspaces } from './shared'

export const automationDefinitions = sqliteTable('automation_definitions', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  triggerJson: text('trigger_json').notNull(),
  recipeJson: text('recipe_json').notNull(),
  createdByKind: text('created_by_kind', {
    enum: ['agent', 'user', 'system'],
  }).notNull().default('agent'),
  createdById: text('created_by_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  lastRunAt: int('last_run_at'),
  nextRunAt: int('next_run_at'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('automation_definitions_workspace_id_idx').on(table.workspaceId),
  byEnabledNextRun: index('automation_definitions_enabled_next_run_at_idx').on(table.enabled, table.nextRunAt),
  byCreatedByAgent: index('automation_definitions_created_by_id_idx').on(table.createdById),
}))

export const automationRuns = sqliteTable('automation_runs', {
  id: textPk(),
  automationDefinitionId: text('automation_definition_id')
    .notNull()
    .references(() => automationDefinitions.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  triggerType: text('trigger_type', {
    enum: ['manual', 'scheduled'],
  }).notNull(),
  occurrenceKey: text('occurrence_key'),
  status: text('status', {
    enum: ['queued', 'running', 'complete', 'failed', 'cancelled'],
  }).notNull().default('queued'),
  triggerSnapshotJson: text('trigger_snapshot_json').notNull(),
  recipeSnapshotJson: text('recipe_snapshot_json').notNull(),
  chatSessionId: text('chat_session_id')
    .references(() => sessions.id, { onDelete: 'set null' }),
  backendRunId: text('backend_run_id')
    .references(() => backendRuns.id, { onDelete: 'set null' }),
  artifactCount: int('artifact_count').notNull().default(0),
  errorText: text('error_text'),
  resultKind: text('result_kind', {
    enum: ['findings', 'no_findings', 'stopped', 'error'],
  }),
  resultSummary: text('result_summary'),
  triageStatus: text('triage_status', {
    enum: ['unread', 'read', 'resolved', 'archived'],
  }),
  triagedAt: int('triaged_at'),
  scheduledFor: int('scheduled_for'),
  claimedAt: int('claimed_at'),
  startedAt: int('started_at'),
  finishedAt: int('finished_at'),
  ...timestamps(),
}, table => ({
  byDefinition: index('automation_runs_definition_id_idx').on(table.automationDefinitionId),
  byWorkspace: index('automation_runs_workspace_id_idx').on(table.workspaceId),
  byStatus: index('automation_runs_status_idx').on(table.status),
  byTriage: index('automation_runs_triage_status_idx').on(table.triageStatus, table.finishedAt),
  byBackendRun: index('automation_runs_backend_run_id_idx').on(table.backendRunId),
  byOccurrence: uniqueIndex('automation_runs_definition_occurrence_unique').on(table.automationDefinitionId, table.occurrenceKey),
}))

export const automationArtifacts = sqliteTable('automation_artifacts', {
  id: textPk(),
  automationRunId: text('automation_run_id')
    .notNull()
    .references(() => automationRuns.id, { onDelete: 'cascade' }),
  automationDefinitionId: text('automation_definition_id')
    .references(() => automationDefinitions.id, { onDelete: 'set null' }),
  kind: text('kind', {
    enum: ['markdown', 'text', 'json', 'file_ref'],
  }).notNull(),
  name: text('name').notNull(),
  mimeType: text('mime_type'),
  content: text('content'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byRun: index('automation_artifacts_run_id_idx').on(table.automationRunId),
  byDefinition: index('automation_artifacts_definition_id_idx').on(table.automationDefinitionId),
}))

export const automationEvents = sqliteTable('automation_events', {
  id: textPk(),
  automationDefinitionId: text('automation_definition_id')
    .references(() => automationDefinitions.id, { onDelete: 'cascade' }),
  automationRunId: text('automation_run_id')
    .references(() => automationRuns.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  message: text('message').notNull(),
  attrsJson: text('attrs_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
}, table => ({
  byDefinition: index('automation_events_definition_id_idx').on(table.automationDefinitionId),
  byRun: index('automation_events_run_id_idx').on(table.automationRunId),
  byCreatedAt: index('automation_events_created_at_idx').on(table.createdAt),
}))

export type AutomationDefinition = typeof automationDefinitions.$inferSelect
export type NewAutomationDefinition = typeof automationDefinitions.$inferInsert
export type AutomationRun = typeof automationRuns.$inferSelect
export type NewAutomationRun = typeof automationRuns.$inferInsert
export type AutomationArtifact = typeof automationArtifacts.$inferSelect
export type NewAutomationArtifact = typeof automationArtifacts.$inferInsert
export type AutomationEvent = typeof automationEvents.$inferSelect
export type NewAutomationEvent = typeof automationEvents.$inferInsert
