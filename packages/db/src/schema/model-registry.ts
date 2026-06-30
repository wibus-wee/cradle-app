import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { timestamps } from './shared'

export const modelRegistryMappings = sqliteTable('model_registry_mappings', {
  modelId: text('model_id').primaryKey(),
  registryModelId: text('registry_model_id').notNull(),
  matchType: text('match_type', {
    enum: ['manual', 'alias'],
  }).notNull().default('alias'),
  modelJson: text('model_json'),
  ...timestamps(),
}, table => ({
  byRegistryModel: index('model_registry_mappings_registry_model_idx').on(table.registryModelId),
}))

export type ModelRegistryMapping = typeof modelRegistryMappings.$inferSelect
export type NewModelRegistryMapping = typeof modelRegistryMappings.$inferInsert
