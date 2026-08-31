import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { base64ToBytes, bytesToBase64, bytesToBase64Url, compareUtf8, utf8Bytes } from './bytes'
import { FabricProtocolError } from './error'

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

export interface FabricCreateRequest {
  ownerPubkey: string
  requestId: string
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
  scopes?: FabricScope[]
}

export interface FabricNodeGrant {
  grantId: string
  fabricId: string
  controllerId: string
  controllerDisplayName?: string
  nodeId: string
  scope: FabricScope
  revokedAt?: string
}

export interface FabricJoinRequest {
  requestId: string
  fabricId: string
  subjectKind: FabricSubjectKind
  subjectId: string
  identityPubkey: string
  encryptionPubkey: string
  displayName: string
  platform: string
  version: string
  capabilities: string[]
  deliverySecretHash: string
  issuedAt: number
  expiresAt: number
  signature: string
}

export interface FabricKeyPair {
  privateKeyBase64: string
  publicKeyBase64: string
}

export interface FabricProtocolRuntime {
  nowSeconds: () => number
  randomBytes: (length: number) => Uint8Array
  randomId: () => string
}

export function generateFabricSigningKeyPair(randomBytes: (length: number) => Uint8Array): FabricKeyPair {
  const privateKey = randomBytes(32)
  return {
    privateKeyBase64: bytesToBase64(privateKey),
    publicKeyBase64: bytesToBase64(ed25519.getPublicKey(privateKey)),
  }
}

export function generateFabricEncryptionKeyPair(randomBytes: (length: number) => Uint8Array): FabricKeyPair {
  const privateKey = randomBytes(32)
  return {
    privateKeyBase64: bytesToBase64(privateKey),
    publicKeyBase64: bytesToBase64(x25519.scalarMultBase(privateKey)),
  }
}

export function publicFabricSigningKey(privateKeyBase64: string): string {
  return bytesToBase64(ed25519.getPublicKey(base64ToBytes(privateKeyBase64)))
}

export function publicFabricEncryptionKey(privateKeyBase64: string): string {
  return bytesToBase64(x25519.scalarMultBase(base64ToBytes(privateKeyBase64)))
}

export function signFabricCertificate(
  ownerPrivateKeyBase64: string,
  input: Omit<MembershipCertificate, 'version' | 'issuedAt' | 'nonce' | 'issuerPubkey' | 'signature'>
    & Partial<Pick<MembershipCertificate, 'issuedAt' | 'nonce'>>,
  runtime: Pick<FabricProtocolRuntime, 'nowSeconds' | 'randomId'>,
): MembershipCertificate {
  const certificate: MembershipCertificate = {
    version: 1,
    fabricId: input.fabricId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    identityPubkey: input.identityPubkey,
    encryptionPubkey: input.encryptionPubkey,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    scopes: canonicalStrings([...new Set(input.scopes)]),
    issuedAt: input.issuedAt ?? runtime.nowSeconds(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    nonce: input.nonce ?? runtime.randomId(),
    issuerPubkey: publicFabricSigningKey(ownerPrivateKeyBase64),
    signature: '',
  }
  return { ...certificate, signature: sign(ownerPrivateKeyBase64, certificatePayload(certificate)) }
}

export function signFabricRequestProof(
  privateKeyBase64: string,
  method: string,
  path: string,
  runtime: Pick<FabricProtocolRuntime, 'nowSeconds' | 'randomId'>,
): FabricRequestProof {
  const proof = {
    pubkey: publicFabricSigningKey(privateKeyBase64),
    method,
    path,
    issuedAt: runtime.nowSeconds(),
    nonce: runtime.randomId(),
  }
  return { ...proof, signature: sign(privateKeyBase64, proof) }
}

export function signFabricCreateRequest(
  ownerPrivateKeyBase64: string,
  runtime: Pick<FabricProtocolRuntime, 'nowSeconds' | 'randomId'>,
): FabricCreateRequest {
  const request = {
    ownerPubkey: publicFabricSigningKey(ownerPrivateKeyBase64),
    requestId: runtime.randomId(),
    issuedAt: runtime.nowSeconds(),
    nonce: runtime.randomId(),
  }
  return { ...request, signature: sign(ownerPrivateKeyBase64, request) }
}

export function signFabricJoinRequest(input: {
  fabricId: string
  subjectKind?: FabricSubjectKind
  subjectId: string
  identityPrivateKeyBase64: string
  encryptionPubkey: string
  displayName: string
  platform: string
  version: string
  capabilities: string[]
  deliverySecret: string
}, runtime: FabricProtocolRuntime): FabricJoinRequest {
  const issuedAt = runtime.nowSeconds()
  const request = {
    requestId: `join_${runtime.randomId()}`,
    fabricId: input.fabricId,
    subjectKind: input.subjectKind ?? 'node',
    subjectId: input.subjectId,
    identityPubkey: publicFabricSigningKey(input.identityPrivateKeyBase64),
    encryptionPubkey: input.encryptionPubkey,
    displayName: input.displayName,
    platform: input.platform,
    version: input.version,
    capabilities: canonicalStrings([...new Set(input.capabilities)]),
    deliverySecretHash: bytesToBase64Url(sha256(utf8Bytes(input.deliverySecret))),
    issuedAt,
    expiresAt: issuedAt + 15 * 60,
  }
  return { ...request, signature: sign(input.identityPrivateKeyBase64, request) }
}

export function verifyFabricCertificate(
  certificate: MembershipCertificate,
  ownerPubkey: string,
  fabricId: string,
  nowSeconds: number,
): void {
  if (
    certificate.version !== 1
    || certificate.fabricId !== fabricId
    || certificate.issuerPubkey !== ownerPubkey
    || (certificate.expiresAt !== undefined && certificate.expiresAt <= nowSeconds)
  ) {
    throw new FabricProtocolError('fabric_membership_invalid', 'Fabric membership certificate is invalid.')
  }
  const valid = ed25519.verify(
    base64ToBytes(certificate.signature),
    utf8Bytes(JSON.stringify(certificatePayload(certificate))),
    base64ToBytes(ownerPubkey),
  )
  if (!valid) {
    throw new FabricProtocolError('fabric_membership_invalid', 'Fabric membership signature is invalid.')
  }
}

export function createFabricAuthHeaderValues(
  certificate: MembershipCertificate,
  identityPrivateKeyBase64: string,
  method: string,
  path: string,
  runtime: Pick<FabricProtocolRuntime, 'nowSeconds' | 'randomId'>,
): Record<'x-cradle-fabric-certificate' | 'x-cradle-fabric-proof', string> {
  return {
    'x-cradle-fabric-certificate': bytesToBase64Url(utf8Bytes(JSON.stringify(certificate))),
    'x-cradle-fabric-proof': bytesToBase64Url(utf8Bytes(JSON.stringify(signFabricRequestProof(
      identityPrivateKeyBase64,
      method,
      path,
      runtime,
    )))),
  }
}

export function randomFabricSecret(runtime: Pick<FabricProtocolRuntime, 'randomBytes'>): string {
  return bytesToBase64Url(runtime.randomBytes(32))
}

function certificatePayload(certificate: MembershipCertificate): Record<string, unknown> {
  return {
    version: certificate.version,
    fabricId: certificate.fabricId,
    subjectKind: certificate.subjectKind,
    subjectId: certificate.subjectId,
    identityPubkey: certificate.identityPubkey,
    encryptionPubkey: certificate.encryptionPubkey,
    ...(certificate.nodeId ? { nodeId: certificate.nodeId } : {}),
    scopes: canonicalStrings(certificate.scopes),
    issuedAt: certificate.issuedAt,
    ...(certificate.expiresAt ? { expiresAt: certificate.expiresAt } : {}),
    nonce: certificate.nonce,
    issuerPubkey: certificate.issuerPubkey,
  }
}

function sign(privateKeyBase64: string, payload: Record<string, unknown>): string {
  return bytesToBase64(ed25519.sign(utf8Bytes(JSON.stringify(payload)), base64ToBytes(privateKeyBase64)))
}

function canonicalStrings<T extends string>(values: T[]): T[] {
  return [...values].sort(compareUtf8)
}
