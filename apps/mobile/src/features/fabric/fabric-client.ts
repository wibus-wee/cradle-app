import type { FabricJoinRequest, MembershipCertificate, NodeSummary } from '@cradle/fabric-protocol'
import {
  createFabricAuthHeaderValues,
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  publicFabricEncryptionKey,
  publicFabricSigningKey,
  randomFabricSecret,
  signFabricJoinRequest,
  verifyFabricCertificate,
} from '@cradle/fabric-protocol'

import { mobileFabricRuntime } from './fabric-runtime'
import type { FabricControllerDescriptor, FabricDirectorySnapshot, FabricEnrollmentDraft, FabricEnrollmentPollResult, FabricPairingCode, FabricSecretState, MobileFabricMembership, PendingFabricControllerEnrollment } from './fabric-types'
import {
  FABRIC_STORAGE_SCHEMA_VERSION,
} from './fabric-types'

interface CreateJoinRequestResponse {
  requestId: string
  expiresAt: string
}

interface ReadJoinRequestResponse {
  status: 'pending' | 'approved' | 'rejected'
  request: FabricJoinRequest
  controllerCertificate?: MembershipCertificate
  rejectedAt?: string
}

interface DirectoryResponse {
  revision: number
  nodes: NodeSummary[]
}

interface RelayErrorBody {
  message?: string
  error?: string
}

export class FabricRelayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'FabricRelayError'
  }
}

async function relayJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const error = await response.json().catch(() => null) as RelayErrorBody | null
    throw new FabricRelayError(
      error?.message ?? error?.error ?? `Fabric Relay returned ${response.status}.`,
      response.status,
    )
  }
  return await response.json() as T
}

export function createFabricEnrollmentDraft(
  pairing: FabricPairingCode,
  descriptor: FabricControllerDescriptor,
): FabricEnrollmentDraft {
  const identity = generateFabricSigningKeyPair(mobileFabricRuntime.randomBytes)
  const encryption = generateFabricEncryptionKeyPair(mobileFabricRuntime.randomBytes)
  const deliverySecret = randomFabricSecret(mobileFabricRuntime)
  const subjectId = `controller_${mobileFabricRuntime.randomId().replaceAll('-', '')}`
  const request = signFabricJoinRequest({
    fabricId: pairing.fabricId,
    subjectKind: 'controller',
    subjectId,
    identityPrivateKeyBase64: identity.privateKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64,
    displayName: descriptor.displayName,
    platform: descriptor.platform,
    version: descriptor.version,
    capabilities: descriptor.capabilities,
    deliverySecret,
  }, mobileFabricRuntime)

  return {
    pending: {
      pairing,
      request,
      expiresAt: new Date(request.expiresAt * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    },
    secrets: {
      schemaVersion: FABRIC_STORAGE_SCHEMA_VERSION,
      identityPrivateKeyBase64: identity.privateKeyBase64,
      encryptionPrivateKeyBase64: encryption.privateKeyBase64,
      pendingDeliverySecret: deliverySecret,
    },
  }
}

export async function ensureFabricEnrollmentRequest(
  pending: PendingFabricControllerEnrollment,
): Promise<void> {
  const created = await relayJson<CreateJoinRequestResponse>(
    `${pending.pairing.relayUrl}/v1/join-requests`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pending.request),
    },
  )
  if (created.requestId !== pending.request.requestId) {
    throw new Error('The Fabric Relay returned a different enrollment request.')
  }
}

export async function pollFabricEnrollment(
  pending: PendingFabricControllerEnrollment,
  secrets: FabricSecretState,
): Promise<FabricEnrollmentPollResult> {
  if (!secrets.pendingDeliverySecret) {
    throw new Error('The pending Fabric request is missing its delivery secret.')
  }
  assertEnrollmentKeyBinding(pending, secrets)
  const response = await relayJson<ReadJoinRequestResponse>(
    `${pending.pairing.relayUrl}/v1/join-requests/${encodeURIComponent(pending.request.requestId)}?secret=${encodeURIComponent(secrets.pendingDeliverySecret)}`,
  )
  if (!sameJoinRequest(response.request, pending.request)) {
    throw new Error('The Fabric Relay returned a mismatched enrollment request.')
  }
  if (response.status === 'pending') {
    return { status: 'pending' }
  }
  if (response.status === 'rejected') {
    return { status: 'rejected', rejectedAt: response.rejectedAt ?? null }
  }
  if (!response.controllerCertificate) {
    throw new Error('The approved Fabric request did not include a Controller certificate.')
  }

  assertControllerCertificate(pending, response.controllerCertificate)
  const directory = await fetchFabricDirectory({
    relayUrl: pending.pairing.relayUrl,
    fabricId: pending.pairing.fabricId,
    certificate: response.controllerCertificate,
    identityPrivateKeyBase64: secrets.identityPrivateKeyBase64,
  })
  const now = new Date().toISOString()
  return {
    status: 'approved',
    membership: {
      schemaVersion: FABRIC_STORAGE_SCHEMA_VERSION,
      relayUrl: pending.pairing.relayUrl,
      fabricId: pending.pairing.fabricId,
      ownerPubkey: pending.pairing.ownerPubkey,
      controllerId: pending.request.subjectId,
      controllerCertificate: response.controllerCertificate,
      directory,
      selectedNodeId: null,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export async function refreshFabricDirectory(
  membership: MobileFabricMembership,
  secrets: FabricSecretState,
): Promise<MobileFabricMembership> {
  assertMembershipKeyBinding(membership, secrets)
  verifyFabricCertificate(
    membership.controllerCertificate,
    membership.ownerPubkey,
    membership.fabricId,
    mobileFabricRuntime.nowSeconds(),
  )
  const directory = await fetchFabricDirectory({
    relayUrl: membership.relayUrl,
    fabricId: membership.fabricId,
    certificate: membership.controllerCertificate,
    identityPrivateKeyBase64: secrets.identityPrivateKeyBase64,
  })
  const selectedNodeId = directory.nodes.some(node => node.nodeId === membership.selectedNodeId)
    ? membership.selectedNodeId
    : null
  return {
    ...membership,
    directory,
    selectedNodeId,
    updatedAt: new Date().toISOString(),
  }
}

export function validateStoredFabricMembership(
  membership: MobileFabricMembership,
  secrets: FabricSecretState,
): void {
  assertMembershipKeyBinding(membership, secrets)
  verifyFabricCertificate(
    membership.controllerCertificate,
    membership.ownerPubkey,
    membership.fabricId,
    mobileFabricRuntime.nowSeconds(),
  )
  if (
    membership.controllerCertificate.subjectKind !== 'controller'
    || membership.controllerCertificate.subjectId !== membership.controllerId
    || membership.controllerCertificate.nodeId !== undefined
    || membership.controllerCertificate.scopes.includes('admin')
    || !membership.controllerCertificate.scopes.includes('control')
  ) {
    throw new Error('The saved Fabric membership is not a valid Mobile Controller identity.')
  }
}

export function selectFabricNode(
  membership: MobileFabricMembership,
  nodeId: string | null,
): MobileFabricMembership {
  if (nodeId !== null) {
    const node = membership.directory.nodes.find(candidate => candidate.nodeId === nodeId)
    if (!node || !node.scopes?.includes('control')) {
      throw new Error('This computer is not authorized for Mobile control.')
    }
  }
  return {
    ...membership,
    selectedNodeId: nodeId,
    updatedAt: new Date().toISOString(),
  }
}

async function fetchFabricDirectory(input: {
  relayUrl: string
  fabricId: string
  certificate: MembershipCertificate
  identityPrivateKeyBase64: string
}): Promise<FabricDirectorySnapshot> {
  const path = `/v1/fabrics/${encodeURIComponent(input.fabricId)}/nodes`
  const headers = createFabricAuthHeaderValues(
    input.certificate,
    input.identityPrivateKeyBase64,
    'GET',
    path,
    mobileFabricRuntime,
  )
  const response = await relayJson<DirectoryResponse>(`${input.relayUrl}${path}`, { headers })
  if (!Number.isSafeInteger(response.revision) || response.revision < 0) {
    throw new Error('The Fabric directory returned an invalid revision.')
  }
  for (const node of response.nodes) {
    if (
      node.fabricId !== input.fabricId
      || !node.scopes
      || node.scopes.some(scope => !input.certificate.scopes.includes(scope))
    ) {
      throw new Error('The Fabric directory returned an unauthorized computer.')
    }
  }
  return {
    revision: response.revision,
    nodes: response.nodes,
    fetchedAt: new Date().toISOString(),
  }
}

function assertControllerCertificate(
  pending: PendingFabricControllerEnrollment,
  certificate: MembershipCertificate,
): void {
  verifyFabricCertificate(
    certificate,
    pending.pairing.ownerPubkey,
    pending.pairing.fabricId,
    mobileFabricRuntime.nowSeconds(),
  )
  if (
    certificate.subjectKind !== 'controller'
    || certificate.subjectId !== pending.request.subjectId
    || certificate.identityPubkey !== pending.request.identityPubkey
    || certificate.encryptionPubkey !== pending.request.encryptionPubkey
    || certificate.nodeId !== undefined
    || certificate.scopes.includes('admin')
    || !certificate.scopes.includes('control')
  ) {
    throw new Error('The approved Controller certificate does not match this device.')
  }
}

function assertEnrollmentKeyBinding(
  pending: PendingFabricControllerEnrollment,
  secrets: FabricSecretState,
): void {
  if (
    publicFabricSigningKey(secrets.identityPrivateKeyBase64) !== pending.request.identityPubkey
    || publicFabricEncryptionKey(secrets.encryptionPrivateKeyBase64) !== pending.request.encryptionPubkey
  ) {
    throw new Error('The saved Fabric keys do not match the pending enrollment.')
  }
}

function assertMembershipKeyBinding(
  membership: MobileFabricMembership,
  secrets: FabricSecretState,
): void {
  if (
    publicFabricSigningKey(secrets.identityPrivateKeyBase64) !== membership.controllerCertificate.identityPubkey
    || publicFabricEncryptionKey(secrets.encryptionPrivateKeyBase64) !== membership.controllerCertificate.encryptionPubkey
  ) {
    throw new Error('The saved Fabric keys do not match this membership.')
  }
}

function sameJoinRequest(actual: FabricJoinRequest, expected: FabricJoinRequest): boolean {
  return actual.requestId === expected.requestId
    && actual.fabricId === expected.fabricId
    && actual.subjectKind === expected.subjectKind
    && actual.subjectId === expected.subjectId
    && actual.identityPubkey === expected.identityPubkey
    && actual.encryptionPubkey === expected.encryptionPubkey
    && actual.displayName === expected.displayName
    && actual.platform === expected.platform
    && actual.version === expected.version
    && actual.deliverySecretHash === expected.deliverySecretHash
    && actual.issuedAt === expected.issuedAt
    && actual.expiresAt === expected.expiresAt
    && actual.signature === expected.signature
    && actual.capabilities.length === expected.capabilities.length
    && actual.capabilities.every((capability, index) => capability === expected.capabilities[index])
}
