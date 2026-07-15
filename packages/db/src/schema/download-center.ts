import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const downloadCenterTasks = sqliteTable(
  'download_center_tasks',
  {
    id: textPk(),
    ownerNamespace: text('owner_namespace').notNull(),
    ownerResourceType: text('owner_resource_type').notNull(),
    ownerResourceId: text('owner_resource_id').notNull(),
    displayName: text('display_name').notNull(),
    fileName: text('file_name').notNull(),
    sourceId: text('source_id'),
    status: text('status', {
      enum: ['queued', 'downloading', 'verifying', 'completed', 'failed', 'cancelled'],
    }).notNull(),
    transferredBytes: int('transferred_bytes').notNull().default(0),
    totalBytes: int('total_bytes'),
    checksumAlgorithm: text('checksum_algorithm'),
    expectedChecksum: text('expected_checksum'),
    actualChecksum: text('actual_checksum'),
    expectedBytes: int('expected_bytes'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(1),
    etag: text('etag'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: int('started_at'),
    finishedAt: int('finished_at'),
    artifactReleasedAt: int('artifact_released_at'),
    ...timestamps(),
  },
  table => ({
    byStatus: index('download_center_tasks_status_idx').on(table.status),
    byUpdatedAt: index('download_center_tasks_updated_at_idx').on(table.updatedAt),
    byOwner: index('download_center_tasks_owner_idx').on(
      table.ownerNamespace,
      table.ownerResourceType,
      table.ownerResourceId,
    ),
  }),
)

export type DownloadCenterTask = typeof downloadCenterTasks.$inferSelect
export type NewDownloadCenterTask = typeof downloadCenterTasks.$inferInsert
