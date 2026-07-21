import { sql } from 'drizzle-orm'
import { index, int, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { messages, sessions } from './chat'
import { providerTargets } from './provider-target'
import { textPk, timestamps } from './shared'

export const backendSessionBindings = sqliteTable(
  'backend_session_bindings',
  {
    id: textPk(),
    chatSessionId: text('chat_session_id')
      .notNull()
      .unique()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    providerTargetId: text('provider_target_id').references(() => providerTargets.id, {
      onDelete: 'restrict',
    }),
    runtimeKind: text('runtime_kind')
      .notNull()
      .default('standard'),
    backendSessionId: text('backend_session_id'),
    backendStateSnapshot: text('backend_state_snapshot'),
    requestedModelId: text('requested_model_id'),
    usageReconciliationStatus: text('usage_reconciliation_status', {
      enum: ['pending', 'completed', 'blocked', 'unavailable'],
    }).notNull().default('pending'),
    usageReconciliationAttemptedAt: int('usage_reconciliation_attempted_at'),
    ...timestamps(),
  },
  table => ({
    byProviderTarget: index('backend_session_bindings_provider_target_id_idx').on(
      table.providerTargetId,
    ),
    byRuntimeKind: index('backend_session_bindings_runtime_kind_idx').on(table.runtimeKind),
    byUsageReconciliationStatus: index('backend_session_bindings_usage_reconciliation_status_idx').on(
      table.runtimeKind,
      table.usageReconciliationStatus,
      table.updatedAt,
    ),
  }),
)

export const backendRuns = sqliteTable(
  'backend_runs',
  {
    id: textPk(),
    bindingId: text('binding_id')
      .references(() => backendSessionBindings.id, { onDelete: 'set null' }),
    chatSessionId: text('chat_session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    origin: text('origin', {
      enum: ['user', 'issue-agent', 'system'],
    }).notNull(),
    status: text('status', {
      enum: ['streaming', 'complete', 'aborted', 'failed'],
    }).notNull(),
    stopReason: text('stop_reason'),
    errorText: text('error_text'),
    startedAt: int('started_at').notNull(),
    finishedAt: int('finished_at'),
  },
  table => ({
    byBinding: index('backend_runs_binding_id_idx').on(table.bindingId),
    byChatSession: index('backend_runs_chat_session_id_idx').on(table.chatSessionId),
    oneStreamingRunPerSession: uniqueIndex('backend_runs_one_streaming_per_session_unique')
      .on(table.chatSessionId)
      .where(sql`${table.status} = 'streaming'`),
    byMessage: index('backend_runs_message_id_idx').on(table.messageId),
    byStartedAt: index('backend_runs_started_at_idx').on(table.startedAt),
  }),
)

export const backendRunSnapshots = sqliteTable(
  'backend_run_snapshots',
  {
    id: textPk(),
    schemaVersion: int('schema_version').notNull(),
    traceId: text('trace_id').notNull(),
    chatSessionId: text('chat_session_id')
      .references(() => sessions.id, { onDelete: 'set null' }),
    runId: text('run_id')
      .references(() => backendRuns.id, { onDelete: 'set null' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    providerTargetId: text('provider_target_id').references(() => providerTargets.id, {
      onDelete: 'set null',
    }),
    runtimeKind: text('runtime_kind').notNull(),
    providerSessionId: text('provider_session_id'),
    modelId: text('model_id'),
    agentId: text('agent_id'),
    workspaceId: text('workspace_id'),
    status: text('status', {
      enum: ['running', 'complete', 'aborted', 'failed'],
    }).notNull(),
    startedAt: int('started_at').notNull(),
    completedAt: int('completed_at'),
    completionReason: text('completion_reason'),
    errorText: text('error_text'),
    summaryJson: text('summary_json').notNull().default('{}'),
  },
  table => ({
    byTrace: index('backend_run_snapshots_trace_id_idx').on(table.traceId),
    byRun: uniqueIndex('backend_run_snapshots_run_id_unique').on(table.runId),
    byChatSession: index('backend_run_snapshots_chat_session_id_idx').on(table.chatSessionId),
    byStartedAt: index('backend_run_snapshots_started_at_idx').on(table.startedAt),
  }),
)

export const backendRunSnapshotEvents = sqliteTable(
  'backend_run_snapshot_events',
  {
    id: textPk(),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => backendRunSnapshots.id, { onDelete: 'cascade' }),
    chatSessionId: text('chat_session_id')
      .references(() => sessions.id, { onDelete: 'set null' }),
    runId: text('run_id')
      .references(() => backendRuns.id, { onDelete: 'set null' }),
    seq: int('seq').notNull(),
    phase: text('phase').notNull(),
    chunkType: text('chunk_type'),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    modelId: text('model_id'),
    promptTokens: int('prompt_tokens'),
    completionTokens: int('completion_tokens'),
    totalTokens: int('total_tokens'),
    estimatedCostUsd: real('estimated_cost_usd'),
    occurredAt: int('occurred_at').notNull(),
    durationMs: int('duration_ms'),
    payloadJson: text('payload_json').notNull().default('{}'),
  },
  table => ({
    bySnapshotSeq: uniqueIndex('backend_run_snapshot_events_snapshot_seq_unique').on(table.snapshotId, table.seq),
    byRun: index('backend_run_snapshot_events_run_id_idx').on(table.runId),
    byToolCall: index('backend_run_snapshot_events_tool_call_id_idx').on(table.toolCallId),
  }),
)

export const backendCapabilitySnapshots = sqliteTable('backend_capability_snapshots', {
  id: textPk(),
  providerTargetId: text('provider_target_id').references(() => providerTargets.id, {
    onDelete: 'restrict',
  }),
  runtimeKind: text('runtime_kind')
    .notNull()
    .default('standard'),
  source: text('source', {
    enum: ['session_start'],
  }).notNull(),
  capabilitiesJson: text('capabilities_json').notNull(),
  recordedAt: int('recorded_at').notNull(),
})

export type BackendSessionBinding = typeof backendSessionBindings.$inferSelect
export type NewBackendSessionBinding = typeof backendSessionBindings.$inferInsert
export type BackendRun = typeof backendRuns.$inferSelect
export type NewBackendRun = typeof backendRuns.$inferInsert
export type BackendRunSnapshot = typeof backendRunSnapshots.$inferSelect
export type NewBackendRunSnapshot = typeof backendRunSnapshots.$inferInsert
export type BackendRunSnapshotEvent = typeof backendRunSnapshotEvents.$inferSelect
export type NewBackendRunSnapshotEvent = typeof backendRunSnapshotEvents.$inferInsert
export type BackendCapabilitySnapshot = typeof backendCapabilitySnapshots.$inferSelect
export type NewBackendCapabilitySnapshot = typeof backendCapabilitySnapshots.$inferInsert
