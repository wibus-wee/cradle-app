import { randomUUID } from 'node:crypto'

import { relayHostEnrollments } from '@cradle/db'
import { asc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { SignedRelayAssertion } from '../relay-servers/relay-signature-service'
import {
  createRelayRoomId,
  generateRelaySigningKeyPair,
  signRelayAssertion,
} from '../relay-servers/relay-signature-service'
import { upsertSecret } from '../secrets/service'
import { generateRelayKeyPair, relayPublicKeyFingerprint } from './crypto'
import type { HostEnrollmentLiveState } from './host-connector'
import { getHostConnectorService } from './host-connector'
import { upsertHostRelayAuthToken } from './relay-auth-token-service'

/**
 * Host-side enrollment service.
 *
 * Creating an enrollment = generating an X25519 keypair, asking relayd to mint
 * a pairing code + room via `POST /pairing/start`, persisting the enrollment
 * (with the private key in the secrets store), and starting the always-on
 * host-connector for it. The returned pairing string
 * `<pairingCode>:<roomId>#<hostKeyFingerprint>` is shown to the user and typed
 * into a controller to claim.
 */

export interface CreateHostEnrollmentInput {
  id?: string
  displayName: string
  relayUrl: string
}

export interface HostEnrollmentView {
  id: string
  displayName: string
  relayUrl: string
  roomId: string
  hostPubkey: string
  hostKeyFingerprint: string
  pinnedControllerPubkey: string | null
  status: 'pending' | 'paired' | 'offline'
  pairingCode: string | null
  lastError: string | null
  createdAt: number
  updatedAt: number
  /** Live in-memory state from the host-connector, or null if it isn't running. */
  live: HostEnrollmentLiveState | null
}

export interface CreatedHostEnrollment extends HostEnrollmentView {
  /** `<pairingCode>:<roomId>#<hostKeyFingerprint>` — show to the user, input on a controller. */
  pairingString: string
  pairingCodeExpiresAt: string | null
}

const RELAY_HOST_KEY_SECRET_KIND = 'system-relay-host-key'
const RELAY_HOST_SIGNING_KEY_SECRET_KIND = 'system-relay-host-signing-key'

export function listHostEnrollments(): HostEnrollmentView[] {
  return db()
    .select()
    .from(relayHostEnrollments)
    .orderBy(asc(relayHostEnrollments.displayName), asc(relayHostEnrollments.id))
    .all()
    .map(toView)
}

export function readHostEnrollment(id: string): HostEnrollmentView {
  const row = db()
    .select()
    .from(relayHostEnrollments)
    .where(eq(relayHostEnrollments.id, id))
    .get()
  if (!row) {
    throw new AppError({ code: 'relay_host_enrollment_not_found', status: 404, message: 'Relay host enrollment not found.', details: { id } })
  }
  return toView(row)
}

export async function createHostEnrollment(input: CreateHostEnrollmentInput): Promise<CreatedHostEnrollment> {
  const relayUrl = input.relayUrl.trim().replace(/\/+$/, '')
  if (!relayUrl) {
    throw new AppError({ code: 'relay_host_enrollment_relay_url_required', status: 400, message: 'Relay URL is required.' })
  }
  const normalizedRelayUrl = new URL(relayUrl).toString().replace(/\/+$/, '')

  const id = input.id ?? randomUUID()
  const keypair = generateRelayKeyPair()
  const signingKeypair = generateRelaySigningKeyPair()
  const roomId = createRelayRoomId()
  const fingerprint = relayPublicKeyFingerprint(keypair.publicKeyBase64)

  const pairingStart = signRelayAssertion(signingKeypair.privateKeyBase64, {
    role: 'host',
    purpose: 'create_room',
    roomId,
  })

  const startResponse = await callPairingStart(normalizedRelayUrl, {
    assertion: pairingStart,
  })

  // Persist the private key as a managed secret.
  const secretId = `relay-host-key:${id}`
  const signingSecretId = `relay-host-sign-key:${id}`
  upsertHostRelayAuthToken({
    enrollmentId: id,
    displayName: input.displayName.trim(),
  })
  upsertSecret({
    id: secretId,
    kind: RELAY_HOST_KEY_SECRET_KIND,
    label: `Relay host key (${input.displayName.trim()})`,
    secret: keypair.privateKeyBase64,
  })
  upsertSecret({
    id: signingSecretId,
    kind: RELAY_HOST_SIGNING_KEY_SECRET_KIND,
    label: `Relay host signing key (${input.displayName.trim()})`,
    secret: signingKeypair.privateKeyBase64,
  })

  const now = Math.floor(Date.now() / 1000)
  db()
    .insert(relayHostEnrollments)
    .values({
      id,
      displayName: input.displayName.trim(),
    relayUrl: normalizedRelayUrl,
      roomId,
      hostPubkey: keypair.publicKeyBase64,
      hostPrivateKeySecretId: secretId,
      pinnedControllerPubkey: null,
      status: 'pending',
      pairingCode: startResponse.pairingCode,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  // Start the always-on connector so the host is ready when a controller claims.
  getHostConnectorService()?.startForEnrollment(id)

  const view = readHostEnrollment(id)
  return {
    ...view,
    pairingString: `${startResponse.pairingCode}:${roomId}#${fingerprint}`,
    pairingCodeExpiresAt: startResponse.expiresAt,
  }
}

export async function deleteHostEnrollment(id: string): Promise<void> {
  const row = db()
    .select()
    .from(relayHostEnrollments)
    .where(eq(relayHostEnrollments.id, id))
    .get()
  if (!row) {
    return
  }
  getHostConnectorService()?.stopForEnrollment(id)
  db().delete(relayHostEnrollments).where(eq(relayHostEnrollments.id, id)).run()
}

export function readHostEnrollmentPairingString(id: string): { pairingString: string, pairingCode: string, hostKeyFingerprint: string } {
  const row = db()
    .select()
    .from(relayHostEnrollments)
    .where(eq(relayHostEnrollments.id, id))
    .get()
  if (!row) {
    throw new AppError({ code: 'relay_host_enrollment_not_found', status: 404, message: 'Relay host enrollment not found.', details: { id } })
  }
  if (!row.pairingCode) {
    throw new AppError({ code: 'relay_host_enrollment_not_pairable', status: 409, message: 'Enrollment is not in the pairing window.' })
  }
  const fingerprint = relayPublicKeyFingerprint(row.hostPubkey)
  return {
    pairingString: `${row.pairingCode}:${row.roomId}#${fingerprint}`,
    pairingCode: row.pairingCode,
    hostKeyFingerprint: fingerprint,
  }
}

interface PairingStartResponse {
  roomId: string
  pairingCode: string
  expiresAt: string
}

async function callPairingStart(relayUrl: string, body: { assertion: SignedRelayAssertion }): Promise<PairingStartResponse> {
  const url = new URL('/pairing/start', `${relayUrl.replace(/\/+$/, '')}/`)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assertion: body.assertion }),
      signal: AbortSignal.timeout(10_000),
    })
  }
  catch (error) {
    throw new AppError({
      code: 'relay_pairing_start_unreachable',
      status: 502,
      message: `Could not reach relayd /pairing/start: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new AppError({
      code: 'relay_pairing_start_failed',
      status: 502,
      message: `relayd /pairing/start returned ${response.status}: ${text}`,
    })
  }
  return await response.json() as PairingStartResponse
}

function toView(row: typeof relayHostEnrollments.$inferSelect): HostEnrollmentView {
  return {
    id: row.id,
    displayName: row.displayName,
    relayUrl: row.relayUrl,
    roomId: row.roomId,
    hostPubkey: row.hostPubkey,
    hostKeyFingerprint: relayPublicKeyFingerprint(row.hostPubkey),
    pinnedControllerPubkey: row.pinnedControllerPubkey,
    status: row.status as 'pending' | 'paired' | 'offline',
    pairingCode: row.pairingCode,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    live: getHostConnectorService()?.getLiveState(row.id) ?? null,
  }
}
