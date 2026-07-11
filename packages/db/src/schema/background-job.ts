import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

export const backgroundJobs = sqliteTable(
  'background_jobs',
  {
    id: textPk(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    ownerNamespace: text('owner_namespace').notNull(),
    ownerResourceType: text('owner_resource_type').notNull(),
    ownerResourceId: text('owner_resource_id').notNull(),
    ownerResourceKey: text('owner_resource_key'),
    kind: text('kind').notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    sourceKind: text('source_kind').notNull(),
    sourceSessionId: text('source_session_id'),
    sourceRunId: text('source_run_id'),
    attempts: int('attempts').notNull().default(1),
    maxAttempts: int('max_attempts').notNull().default(1),
    contextJson: text('context_json').notNull().default('{}'),
    progressJson: text('progress_json'),
    resultJson: text('result_json'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorDetailsJson: text('error_details_json'),
    cancelRequestedAt: int('cancel_requested_at'),
    startedAt: int('started_at'),
    finishedAt: int('finished_at'),
    projectedAt: int('projected_at'),
    projectionAttempts: int('projection_attempts').notNull().default(0),
    projectionError: text('projection_error'),
    ...timestamps(),
  },
  table => ({
    byWorkspace: index('background_jobs_workspace_id_idx').on(table.workspaceId),
    byStatus: index('background_jobs_status_idx').on(table.status),
    byOwner: index('background_jobs_owner_idx').on(
      table.ownerNamespace,
      table.ownerResourceType,
      table.ownerResourceId,
    ),
    byOwnerKind: index('background_jobs_owner_kind_idx').on(
      table.ownerNamespace,
      table.kind,
      table.ownerResourceId,
    ),
    bySource: index('background_jobs_source_idx').on(table.sourceKind, table.sourceRunId),
    byProjection: index('background_jobs_projection_idx').on(table.status, table.projectedAt),
  }),
)

export type BackgroundJob = typeof backgroundJobs.$inferSelect
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert
