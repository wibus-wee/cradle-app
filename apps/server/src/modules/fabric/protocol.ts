import { randomBytes, randomUUID } from 'node:crypto'

import type {
  FabricJoinRequest,
  FabricKeyPair,
  FabricRequestProof,
  FabricSubjectKind,
  MembershipCertificate,
} from '@cradle/fabric-protocol'
import {
  createFabricAuthHeaderValues,
  generateFabricEncryptionKeyPair as generateEncryptionKeyPair,
  generateFabricSigningKeyPair as generateSigningKeyPair,
  publicFabricSigningKey,
  randomFabricSecret as createRandomFabricSecret,
  signFabricCertificate as signCertificate,
  signFabricCreateRequest as signCreateRequest,
  signFabricJoinRequest as signJoinRequest,
  signFabricRequestProof as signRequestProof,
  verifyFabricCertificate,
} from '@cradle/fabric-protocol'

import { AppError } from '../../errors/app-error'

export type {
  FabricJoinRequest,
  FabricKeyPair,
  FabricNodeGrant,
  FabricRequestProof,
  FabricScope,
  FabricSubjectKind,
  MembershipCertificate,
  NodeSummary,
} from '@cradle/fabric-protocol'

const runtime = {
  nowSeconds: () => Math.floor(Date.now() / 1000),
  randomBytes: (length: number) => new Uint8Array(randomBytes(length)),
  randomId: randomUUID,
}

export interface FabricEncryptionKeyPair extends FabricKeyPair {}

export function generateFabricSigningKeyPair(): FabricKeyPair {
  return generateSigningKeyPair(runtime.randomBytes)
}

export function generateFabricEncryptionKeyPair(): FabricEncryptionKeyPair {
  return generateEncryptionKeyPair(runtime.randomBytes)
}

export { publicFabricSigningKey }

export function signFabricCertificate(
  ownerPrivateKeyBase64: string,
  input: Omit<MembershipCertificate, 'version' | 'issuedAt' | 'nonce' | 'issuerPubkey' | 'signature'>
    & Partial<Pick<MembershipCertificate, 'issuedAt' | 'nonce'>>,
): MembershipCertificate {
  return signCertificate(ownerPrivateKeyBase64, input, runtime)
}

export function signFabricRequestProof(
  privateKeyBase64: string,
  method: string,
  path: string,
): FabricRequestProof {
  return signRequestProof(privateKeyBase64, method, path, runtime)
}

export function signFabricCreateRequest(ownerPrivateKeyBase64: string) {
  return signCreateRequest(ownerPrivateKeyBase64, runtime)
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
}): FabricJoinRequest {
  return signJoinRequest(input, runtime)
}

export function fabricAuthHeaders(
  certificate: MembershipCertificate,
  identityPrivateKeyBase64: string,
  method: string,
  path: string,
): Headers {
  return new Headers(createFabricAuthHeaderValues(
    certificate,
    identityPrivateKeyBase64,
    method,
    path,
    runtime,
  ))
}

export function ownerProofHeaders(
  ownerPrivateKeyBase64: string,
  method: string,
  path: string,
): Headers {
  const headers = new Headers()
  const proof = signFabricRequestProof(ownerPrivateKeyBase64, method, path)
  headers.set(
    'x-cradle-fabric-proof',
    Buffer.from(JSON.stringify(proof), 'utf8').toString('base64').replace(/=+$/u, ''),
  )
  return headers
}

export function fabricHeadersRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => { record[key] = value })
  return record
}

export function assertFabricCertificate(
  certificate: MembershipCertificate,
  ownerPubkey: string,
  fabricId: string,
): void {
  try {
    verifyFabricCertificate(certificate, ownerPubkey, fabricId, runtime.nowSeconds())
  }
  catch (error) {
    throw new AppError({
      code: 'fabric_membership_invalid',
      status: 401,
      message: error instanceof Error ? error.message : 'Fabric membership certificate is invalid.',
    })
  }
}

export function randomFabricSecret(): string {
  return createRandomFabricSecret(runtime)
}
