import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

/**
 * A relay-transport enrollment on the HOST side (the remote, possibly
 * headless Cradle Server that initiates pairing).
 *
 * The host generates an X25519 keypair, calls relayd `POST /pairing/start` to
 * mint a pairing code + room, and persists this record so it can reconnect to
 * the same room after a restart without re-pairing. The private key is stored
 * in the secrets table (referenced by `hostPrivateKeySecretId`); only the
 * public key lives here in plaintext.
 *
 * Once a controller claims the pairing code and the first handshake completes,
 * `pinnedControllerPubkey` is set and `status` flips to `paired`. Subsequent
 * reconnects rely on the pinned pubkeys (no pairing code needed).
 */
export const relayHostEnrollments = sqliteTable(
  'relay_host_enrollments',
  {
    id: textPk(),
    displayName: text('display_name').notNull(),
    relayUrl: text('relay_url').notNull(),
    roomId: text('room_id').notNull(),
    hostPubkey: text('host_pubkey').notNull(),
    hostPrivateKeySecretId: text('host_private_key_secret_id').notNull(),
    pinnedControllerPubkey: text('pinned_controller_pubkey'),
    status: text('status').notNull().default('pending'), // pending | paired | offline
    pairingCode: text('pairing_code'),
    lastError: text('last_error'),
    ...timestamps(),
  },
  table => ({
    byStatus: index('relay_host_enrollments_status_idx').on(table.status),
    byRoom: index('relay_host_enrollments_room_idx').on(table.roomId),
  }),
)

export type RelayHostEnrollment = typeof relayHostEnrollments.$inferSelect
export type NewRelayHostEnrollment = typeof relayHostEnrollments.$inferInsert
