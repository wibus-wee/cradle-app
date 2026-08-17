import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { ed25519, x25519 } from '@noble/curves/ed25519'

import { AppError } from '../../errors/app-error'

export type FabricScope = 'view' | 'control' | 'approve' | 'admin'
export type FabricSubjectKind = 'node' | 'controller'

export interface MembershipCertificate {
  version: 1
  fabricId: string
  subjectKind: FabricSubjectKind
  subjectId: string
  identityPubkey: string
  encryptionPubkey: string
  nodeId?: string
  scopes: FabricScope[]
  issuedAt: number
  expiresAt?: number
  nonce: string
  issuerPubkey: string
  signature: string
}

export interface FabricRequestProof {
  pubkey: string
  method: string
  path: string
  issuedAt: number
  nonce: string
  signature: string
}

export interface NodeSummary {
  nodeId: string
  fabricId: string
  displayName: string
  platform: string
  version: string
  capabilities: string[]
  status: 'online' | 'offline'
  lastSeenAt: string
  revision: number
  /** This Controller's active grant scopes over the Node (directory listings only). */
  scopes?: FabricScope[]
}

/** One Controller grant over a Node, as recorded by the relayd directory. */
export interface FabricNodeGrant {
  grantId: string
  fabricId: string
  controllerId: string
  nodeId: string
  scope: FabricScope
  revokedAt?: string
}

export interface FabricKeyPair {
  privateKeyBase64: string
  publicKeyBase64: string
}

export interface FabricEncryptionKeyPair extends FabricKeyPair {}

export function generateFabricSigningKeyPair(): FabricKeyPair {
  const privateKey = ed25519.utils.randomPrivateKey()
  return { privateKeyBase64: toBase64(privateKey), publicKeyBase64: toBase64(ed25519.getPublicKey(privateKey)) }
}

export function generateFabricEncryptionKeyPair(): FabricEncryptionKeyPair {
  const privateKey = x25519.utils.randomPrivateKey()
  return { privateKeyBase64: toBase64(privateKey), publicKeyBase64: toBase64(x25519.scalarMultBase(privateKey)) }
}

export function publicFabricSigningKey(privateKeyBase64: string): string {
  return toBase64(ed25519.getPublicKey(fromBase64(privateKeyBase64)))
}

export function signFabricCertificate(
  ownerPrivateKeyBase64: string,
  input: Omit<MembershipCertificate, 'version' | 'issuedAt' | 'nonce' | 'issuerPubkey' | 'signature'>
    & Partial<Pick<MembershipCertificate, 'issuedAt' | 'nonce'>>,
): MembershipCertificate {
  const certificate: MembershipCertificate = {
    version: 1,
    fabricId: input.fabricId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    identityPubkey: input.identityPubkey,
    encryptionPubkey: input.encryptionPubkey,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    scopes: [...new Set(input.scopes)].sort(),
    issuedAt: input.issuedAt ?? unixSeconds(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    nonce: input.nonce ?? randomUUID(),
    issuerPubkey: publicFabricSigningKey(ownerPrivateKeyBase64),
    signature: '',
  }
  return { ...certificate, signature: sign(ownerPrivateKeyBase64, certificatePayload(certificate)) }
}

export function signFabricRequestProof(
  privateKeyBase64: string,
  method: string,
  path: string,
): FabricRequestProof {
  const proof = {
    pubkey: publicFabricSigningKey(privateKeyBase64),
    method,
    path,
    issuedAt: unixSeconds(),
    nonce: randomUUID(),
  }
  return { ...proof, signature: sign(privateKeyBase64, proof) }
}

export function signFabricCreateRequest(ownerPrivateKeyBase64: string): {
  ownerPubkey: string
  requestId: string
  issuedAt: number
  nonce: string
  signature: string
} {
  const request = {
    ownerPubkey: publicFabricSigningKey(ownerPrivateKeyBase64),
    requestId: randomUUID(),
    issuedAt: unixSeconds(),
    nonce: randomUUID(),
  }
  return { ...request, signature: sign(ownerPrivateKeyBase64, request) }
}

export function signFabricJoinRequest(input: {
  fabricId: string
  subjectId: string
  identityPrivateKeyBase64: string
  encryptionPubkey: string
  displayName: string
  platform: string
  version: string
  capabilities: string[]
  deliverySecret: string
}): Record<string, unknown> {
  const request = {
    requestId: `join_${randomUUID()}`,
    fabricId: input.fabricId,
    subjectKind: 'node' as const,
    subjectId: input.subjectId,
    identityPubkey: publicFabricSigningKey(input.identityPrivateKeyBase64),
    encryptionPubkey: input.encryptionPubkey,
    displayName: input.displayName,
    platform: input.platform,
    version: input.version,
    capabilities: [...new Set(input.capabilities)].sort(),
    deliverySecretHash: createHash('sha256').update(input.deliverySecret).digest('base64url'),
    issuedAt: unixSeconds(),
    expiresAt: unixSeconds() + 15 * 60,
  }
  return { ...request, signature: sign(input.identityPrivateKeyBase64, request) }
}

export function fabricAuthHeaders(certificate: MembershipCertificate, identityPrivateKeyBase64: string, method: string, path: string): Headers {
  const headers = new Headers()
  headers.set('x-cradle-fabric-certificate', toRawBase64(new TextEncoder().encode(JSON.stringify(certificate))))
  headers.set('x-cradle-fabric-proof', toRawBase64(new TextEncoder().encode(JSON.stringify(signFabricRequestProof(identityPrivateKeyBase64, method, path)))))
  return headers
}

export function ownerProofHeaders(ownerPrivateKeyBase64: string, method: string, path: string): Headers {
  const headers = new Headers()
  headers.set('x-cradle-fabric-proof', toRawBase64(new TextEncoder().encode(JSON.stringify(signFabricRequestProof(ownerPrivateKeyBase64, method, path)))))
  return headers
}

export function fabricHeadersRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => { record[key] = value })
  return record
}

export function assertFabricCertificate(certificate: MembershipCertificate, ownerPubkey: string, fabricId: string): void {
  if (certificate.version !== 1 || certificate.fabricId !== fabricId || certificate.issuerPubkey !== ownerPubkey || (certificate.expiresAt && certificate.expiresAt <= unixSeconds())) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 401, message: 'Fabric membership certificate is invalid.' })
  }
  const valid = ed25519.verify(fromBase64(certificate.signature), new TextEncoder().encode(JSON.stringify(certificatePayload(certificate))), fromBase64(ownerPubkey))
  if (!valid) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 401, message: 'Fabric membership signature is invalid.' })
  }
}

export function randomFabricSecret(): string { return randomBytes(32).toString('base64url') }

function certificatePayload(certificate: MembershipCertificate): Record<string, unknown> {
  return {
    version: certificate.version,
    fabricId: certificate.fabricId,
    subjectKind: certificate.subjectKind,
    subjectId: certificate.subjectId,
    identityPubkey: certificate.identityPubkey,
    encryptionPubkey: certificate.encryptionPubkey,
    ...(certificate.nodeId ? { nodeId: certificate.nodeId } : {}),
    scopes: [...certificate.scopes].sort(),
    issuedAt: certificate.issuedAt,
    ...(certificate.expiresAt ? { expiresAt: certificate.expiresAt } : {}),
    nonce: certificate.nonce,
    issuerPubkey: certificate.issuerPubkey,
  }
}

function sign(privateKeyBase64: string, payload: Record<string, unknown>): string {
  return toBase64(ed25519.sign(new TextEncoder().encode(JSON.stringify(payload)), fromBase64(privateKeyBase64)))
}

function unixSeconds(): number { return Math.floor(Date.now() / 1000) }
function toBase64(value: Uint8Array): string { return Buffer.from(value).toString('base64') }
function toRawBase64(value: Uint8Array): string { return Buffer.from(value).toString('base64').replace(/=+$/u, '') }
function fromBase64(value: string): Uint8Array { return new Uint8Array(Buffer.from(value, 'base64')) }
