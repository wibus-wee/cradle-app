import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { providerTargets } from './provider-target'
import { textPk, timestamps } from './shared'

export const agentCredentials = sqliteTable('agent_credentials', {
  id: textPk(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  ...timestamps(),
})

export const agents = sqliteTable('agents', {
  id: textPk(),
  name: text('name').notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  avatarStyle: text('avatar_style').notNull().default('bottts-neutral'),
  avatarSeed: text('avatar_seed').notNull(),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'restrict' }),
  modelId: text('model_id'),
  thinkingEffort: text('thinking_effort', {
    enum: ['low', 'medium', 'high', 'xhigh'],
  }).notNull().default('high'),
  runtimeKind: text('runtime_kind').notNull().default('standard'),
  configJson: text('config_json').notNull().default('{}'),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps(),
})

export type AgentCredential = typeof agentCredentials.$inferSelect
export type NewAgentCredential = typeof agentCredentials.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
