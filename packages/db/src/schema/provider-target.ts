import { sql } from 'drizzle-orm'
import { check, index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const providerTargetKinds = ['manual', 'external'] as const

export type ProviderTargetKind = (typeof providerTargetKinds)[number]

export function providerTargetKindColumn(name: string) {
  return text(name, { enum: providerTargetKinds })
}

export const providerTargets = sqliteTable('provider_targets', {
  id: textPk(),
  kind: providerTargetKindColumn('kind').notNull(),
  providerKind: text('provider_kind', {
    enum: ['openai-compatible', 'anthropic', 'universal'],
  }).notNull(),
  displayName: text('display_name').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  iconSlug: text('icon_slug'),
  connectionConfigJson: text('connection_config_json').notNull().default('{}'),
  credentialRef: text('credential_ref'),
  enabledModelsJson: text('enabled_models_json').notNull().default('[]'),
  customModelsJson: text('custom_models_json').notNull().default('[]'),
  sourceKey: text('source_key'),
  externalRecordId: text('external_record_id'),
  sourceFingerprint: text('source_fingerprint'),
  ...timestamps(),
}, table => ({
  byKind: index('provider_targets_kind_idx').on(table.kind),
  byEnabled: index('provider_targets_enabled_idx').on(table.enabled),
  bySourceRecord: uniqueIndex('provider_targets_source_record_unique')
    .on(table.sourceKey, table.externalRecordId),
  kindSourceShape: check(
    'provider_targets_kind_source_shape_check',
    sql`
      (
        ${table.kind} = 'manual'
        AND ${table.sourceKey} IS NULL
        AND ${table.externalRecordId} IS NULL
      )
      OR
      (
        ${table.kind} = 'external'
        AND ${table.sourceKey} IS NOT NULL
        AND ${table.externalRecordId} IS NOT NULL
      )
    `,
  ),
}))

export type ProviderTarget = typeof providerTargets.$inferSelect
export type NewProviderTarget = typeof providerTargets.$inferInsert
