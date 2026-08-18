import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { timestamps } from './shared'

/** The one local identity used to join a Cradle Fabric. Secret fields are refs
 * into the managed secret store; the database never contains private keys. */
export const fabricMembership = sqliteTable('fabric_membership', {
  fabricId: text('fabric_id').primaryKey(),
  relayUrl: text('relay_url').notNull(),
  localNodeId: text('local_node_id').notNull(),
  role: text('role').notNull(), // owner | node | controller
  ownerKeySecretId: text('owner_key_secret_id'),
  identityKeySecretId: text('identity_key_secret_id').notNull(),
  encryptionKeySecretId: text('encryption_key_secret_id').notNull(),
  certificateJson: text('certificate_json').notNull(),
  ...timestamps(),
})

export type FabricMembership = typeof fabricMembership.$inferSelect
export type NewFabricMembership = typeof fabricMembership.$inferInsert
