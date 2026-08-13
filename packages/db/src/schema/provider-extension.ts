import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { agentCredentials } from './identity'
import { providerTargets } from './provider-target'
import { textPk, timestamps } from './shared'

export const providerExtensionStatuses = [
  'disabled',
  'enabling',
  'enabled',
  'disabling',
  'suspended',
  'error',
] as const

export const providerExtensionCredentialStrategies = [
  'borrowed-static',
  'exclusive-refreshable',
] as const

export const providerExtensionCredentialOwners = ['host', 'extension'] as const

export const providerExtensionLeasePhases = [
  'none',
  'acquiring',
  'acquired',
  'releasing',
  'release-pending',
] as const

export const providerExtensionBindings = sqliteTable('provider_extension_bindings', {
  id: textPk(),
  providerTargetId: text('provider_target_id').notNull().references(() => providerTargets.id, {
    onDelete: 'cascade',
  }),
  extensionOwner: text('extension_owner').notNull(),
  extensionId: text('extension_id').notNull(),
  desiredEnabled: int('desired_enabled', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: providerExtensionStatuses }).notNull().default('disabled'),
  activationJson: text('activation_json').notNull().default('{}'),
  outputCredentialRef: text('output_credential_ref').references(() => agentCredentials.id, {
    onDelete: 'set null',
  }),
  sourceFingerprint: text('source_fingerprint'),
  credentialStrategy: text('credential_strategy', {
    enum: providerExtensionCredentialStrategies,
  }),
  credentialOwner: text('credential_owner', {
    enum: providerExtensionCredentialOwners,
  }).notNull().default('host'),
  leaseEpoch: int('lease_epoch').notNull().default(0),
  leasePhase: text('lease_phase', {
    enum: providerExtensionLeasePhases,
  }).notNull().default('none'),
  leaseStateJson: text('lease_state_json').notNull().default('{}'),
  lastError: text('last_error'),
  ...timestamps(),
}, table => ({
  byTarget: index('provider_extension_bindings_target_idx').on(table.providerTargetId),
  byOwner: index('provider_extension_bindings_owner_idx').on(table.extensionOwner),
  byStatus: index('provider_extension_bindings_status_idx').on(table.status),
  targetExtensionUnique: uniqueIndex('provider_extension_bindings_target_extension_unique')
    .on(table.providerTargetId, table.extensionOwner, table.extensionId),
}))

export type ProviderExtensionBinding = typeof providerExtensionBindings.$inferSelect
export type NewProviderExtensionBinding = typeof providerExtensionBindings.$inferInsert
