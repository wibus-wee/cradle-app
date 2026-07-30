import { int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createdAt, textPk } from './shared'

export const blobs = sqliteTable('blobs', {
  id: textPk(),
  sha256: text('sha256').notNull(),
  mediaType: text('media_type').notNull(),
  byteSize: int('byte_size').notNull(),
  storagePath: text('storage_path').notNull(),
  ...createdAt(),
}, table => ({
  byContentType: uniqueIndex('blobs_sha256_media_type_unique').on(table.sha256, table.mediaType),
}))

export type Blob = typeof blobs.$inferSelect
export type NewBlob = typeof blobs.$inferInsert
