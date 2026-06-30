import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt, textPk, workspaces } from './shared'

export const assets = sqliteTable('assets', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mediaType: text('media_type').notNull(),
  byteSize: int('byte_size').notNull(),
  width: int('width'),
  height: int('height'),
  sha256: text('sha256').notNull(),
  storagePath: text('storage_path').notNull(),
  ...createdAt(),
}, table => ({
  byWorkspace: index('assets_workspace_id_idx').on(table.workspaceId),
  bySha256: index('assets_sha256_idx').on(table.sha256),
}))

export type Asset = typeof assets.$inferSelect
