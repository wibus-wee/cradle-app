import { createHmac, randomUUID } from 'node:crypto'

import { AppError } from '../../errors/app-error'
import { readSecret, upsertSecret } from '../secrets/service'

export type RelayTokenRole = 'host' | 'controller'
export type RelayTokenPurpose = 'pairing_start' | 'pairing_claim' | 'room_start' | 'ws'

export interface MintRelayTokenInput {
  subject: string
  purpose: RelayTokenPurpose
  role?: RelayTokenRole
  roomId?: string
  ttlMs?: number
}

export interface MintedRelayToken {
  token: string
  expiresAt: string
}

interface RelayClaims {
  iss: string
  aud: string
  sub: string
  role?: RelayTokenRole
  roomId?: string
  exp: number
  iat: number
  jti: string
  nonce: string
  purpose: RelayTokenPurpose
}

const defaultRelayTokenTTL = 5 * 60 * 1000
const managedRelayHMACSecretId = 'system:remote-relay-hmac:v1'
const managedRelayHMACSecretKind = 'system-relay-hmac-secret'
const managedRelayHMACSecretLabel = 'Remote relay HMAC signing key'

/**
 * Built-in dev-only HMAC secret, used when no env secret is set and no managed
 * secret has been stored yet. This is the SAME value `apps/relayd` falls back to
 * (see `internal/config/config.go` DefaultDevHMACSecret), so a fresh local
 * Cradle Server and a bare `go run ./cmd/relayd` agree on the secret with zero
 * configuration. It is publicly known and insecure; production must set
 * CRADLE_RELAY_HMAC_SECRET on the server (and CRADLE_RELAYD_DEV_HMAC_SECRET on
 * the relay). Keep this string in sync with the relayd constant.
 */
const defaultDevRelayHMACSecret = 'cradle-dev-relay-insecure-secret-do-not-use-in-production'

export function createRelayRoomId(): string {
  return `room_${randomUUID()}`
}

export function mintRelayToken(input: MintRelayTokenInput): MintedRelayToken {
  const secret = relayTokenSecret()
  const now = Date.now()
  const ttlMs = input.ttlMs ?? defaultRelayTokenTTL
  const claims: RelayClaims = {
    iss: process.env.CRADLE_RELAY_TOKEN_ISSUER?.trim() || 'cradle-server',
    aud: process.env.CRADLE_RELAY_TOKEN_AUDIENCE?.trim() || 'cradle-relay',
    sub: input.subject,
    ...(input.role ? { role: input.role } : {}),
    ...(input.roomId ? { roomId: input.roomId } : {}),
    exp: Math.floor((now + ttlMs) / 1000),
    iat: Math.floor(now / 1000),
    jti: randomUUID(),
    nonce: randomUUID(),
    purpose: input.purpose,
  }
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify(claims))
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url')
  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(now + ttlMs).toISOString(),
  }
}

export function relayTokenSecret(): string {
  const secret = process.env.CRADLE_RELAY_HMAC_SECRET?.trim()
    || process.env.CRADLE_RELAYD_DEV_HMAC_SECRET?.trim()
  if (secret) {
    return secret
  }
  if (isProductionEnvironment()) {
    throw new AppError({
      code: 'relay_hmac_secret_required',
      status: 500,
      message: 'Relay HMAC secret is required in production.',
    })
  }
  return readOrCreateManagedRelayHMACSecret()
}

function readOrCreateManagedRelayHMACSecret(): string {
  // Reuse an already-stored managed secret if one exists (e.g. a previously
  // generated random secret on an existing local DB).
  try {
    return readSecret(managedRelayHMACSecretId)
  }
  catch (error) {
    if (isSecretStoreNotConfigured(error)) {
      return defaultDevRelayHMACSecret
    }
    if (!isSecretNotFound(error)) {
      throw error
    }
  }

  // First run with no env secret: persist the built-in dev default so the
  // stored value matches what a bare `go run ./cmd/relayd` uses, and the two
  // services pair with zero configuration. The value is insecure by design;
  // production sets the env var (which short-circuits above).
  try {
    upsertSecret({
      id: managedRelayHMACSecretId,
      kind: managedRelayHMACSecretKind,
      label: managedRelayHMACSecretLabel,
      secret: defaultDevRelayHMACSecret,
    })
  }
  catch (error) {
    if (!isSecretStoreNotConfigured(error)) {
      throw error
    }
  }
  return defaultDevRelayHMACSecret
}

function isSecretNotFound(error: unknown): boolean {
  return error instanceof AppError && error.code === 'secret_not_found'
}

function isSecretStoreNotConfigured(error: unknown): boolean {
  return error instanceof AppError && error.code === 'secret_not_configured'
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV?.toLowerCase() === 'production' || process.env.CRADLE_ENV?.toLowerCase() === 'production'
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}
