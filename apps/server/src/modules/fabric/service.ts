import { randomUUID } from 'node:crypto'
import { hostname, platform } from 'node:os'

import type { FabricMembership } from '@cradle/db'
import { fabricMembership } from '@cradle/db'
import { asc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { readProcessTreeResourceUsage } from '../../infra/process-resources'
import { readSecret, removeSecret, upsertSecret } from '../secrets/service'
import { FabricDirectoryClient } from './directory-client'
import type { FabricJoinRequest, FabricNodeGrant, FabricScope, MembershipCertificate, NodeSummary } from './protocol'
import {
  assertFabricCertificate,
  fabricAuthHeaders,
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  ownerProofHeaders,
  randomFabricSecret,
  signFabricCertificate,
  signFabricCreateRequest,
  signFabricJoinRequest,
} from './protocol'

interface StoredCertificates {
  node: MembershipCertificate
  controller?: MembershipCertificate
}

interface StoredPendingEnrollment {
  requestId?: string
  deliverySecret?: string
  expiresAt?: string
}

export interface FabricMembershipView {
  fabricId: string
  relayUrl: string
  localNodeId: string
  role: string
  ownerPubkey: string
  nodeCertificate: MembershipCertificate
  controllerCertificate?: MembershipCertificate
  createdAt: number
  updatedAt: number
}

type FabricMembershipSecretRefs = Pick<FabricMembership, 'ownerKeySecretId' | 'identityKeySecretId' | 'encryptionKeySecretId'>

export interface FabricNodeInvitation {
  version: 1
  relayUrl: string
  fabricId: string
  requestId: string
  deliverySecret: string
  expiresAt: string
}

export interface PendingFabricEnrollmentView {
  version: 1
  relayUrl: string
  fabricId: string
  requestId: string
  deliverySecret: string
  expiresAt: string | null
  createdAt: number
}

export interface PendingFabricNodeRequestView {
  requestId: string
  displayName: string
  platform: string
  version: string
  capabilities: string[]
  requestedAt: string
  expiresAt: string
}

export interface PendingFabricControllerRequestView extends PendingFabricNodeRequestView {
  subjectId: string
  identityPubkey: string
  encryptionPubkey: string
}

type FabricMembershipChangedListener = () => void

const fabricMembershipChangedListeners = new Set<FabricMembershipChangedListener>()

/** Register runtime owners that need to react to a membership becoming usable. */
export function registerFabricMembershipChangedListener(
  listener: FabricMembershipChangedListener,
): () => void {
  fabricMembershipChangedListeners.add(listener)
  return () => fabricMembershipChangedListeners.delete(listener)
}

function notifyFabricMembershipChanged(): void {
  for (const listener of fabricMembershipChangedListeners) {
    listener()
  }
}

function localNodeDisplayName(input?: string): string {
  return input?.trim() || process.env.CRADLE_FABRIC_NODE_NAME?.trim() || hostname()
}

export interface CreateFabricInput {
  relayUrl: string
  displayName?: string
  platform?: string
  version?: string
  capabilities?: string[]
}

export function getFabricMembership(): FabricMembershipView | null {
  const row = db().select().from(fabricMembership).orderBy(asc(fabricMembership.createdAt)).get()
  return row && row.role !== 'pending-node' ? toView(row) : null
}

/** Update this Server's local Relay bootstrap address without changing Fabric identity. */
export function updateFabricRelayUrl(input: { relayUrl: string }): FabricMembershipView {
  const membership = getFabricMembership()
  if (!membership) {
    throw new AppError({ code: 'fabric_membership_required', status: 409, message: 'This Cradle Server has not joined a Fabric yet.' })
  }
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const updated = db().update(fabricMembership).set({
    relayUrl,
    updatedAt: currentUnixSeconds(),
  }).where(eq(fabricMembership.fabricId, membership.fabricId)).returning().get()
  if (!updated) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 500, message: 'Fabric membership disappeared while updating its Relay URL.' })
  }
  notifyFabricMembershipChanged()
  return toView(updated)
}

/**
 * Return the Relay endpoint selected by Cradle Desktop. Standalone servers
 * intentionally have no implicit relay.
 */
export function getManagedRelay(): { relayUrl: string, accessMode: 'local' | 'network' | 'external' } | null {
  const relayUrl = process.env.CRADLE_RELAYD_PUBLIC_URL?.trim()
  if (!relayUrl) {
    return null
  }
  const accessMode = process.env.CRADLE_RELAYD_ACCESS_MODE === 'external'
    ? 'external'
    : process.env.CRADLE_RELAYD_ACCESS_MODE === 'network' ? 'network' : 'local'
  return { relayUrl, accessMode }
}

export interface ManagedRelayResources {
  source: 'managed' | 'external' | 'unavailable'
  running: boolean
  pid: number | null
  rssMB: number | null
  cpuPercent: number | null
  descendantCount: number | null
}

/** Read the local process tree only; an external Relay is not part of this host's resource total. */
export function getManagedRelayResources(): ManagedRelayResources {
  if (process.env.CRADLE_RELAYD_ACCESS_MODE === 'external') {
    return {
      source: 'external',
      running: false,
      pid: null,
      rssMB: null,
      cpuPercent: null,
      descendantCount: null,
    }
  }

  const pid = Number.parseInt(process.env.CRADLE_RELAYD_PID ?? '', 10)
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      source: 'unavailable',
      running: false,
      pid: null,
      rssMB: null,
      cpuPercent: null,
      descendantCount: null,
    }
  }

  const usage = readProcessTreeResourceUsage(pid)
  return {
    source: 'managed',
    running: usage !== null,
    pid,
    rssMB: usage?.rssMB ?? null,
    cpuPercent: usage?.cpuPercent ?? null,
    descendantCount: usage?.descendantCount ?? null,
  }
}

export function hasPendingNodeEnrollment(): boolean {
  return db().select({ role: fabricMembership.role }).from(fabricMembership).orderBy(asc(fabricMembership.createdAt)).get()?.role === 'pending-node'
}

export function getPendingNodeEnrollment(): PendingFabricEnrollmentView | null {
  const row = db().select().from(fabricMembership).orderBy(asc(fabricMembership.createdAt)).get()
  if (!row || row.role !== 'pending-node') {
    return null
  }
  const pending = parsePendingEnrollment(row.certificateJson)
  return {
    version: 1,
    relayUrl: row.relayUrl,
    fabricId: row.fabricId,
    requestId: pending.requestId,
    deliverySecret: pending.deliverySecret,
    expiresAt: pending.expiresAt ?? null,
    createdAt: row.createdAt,
  }
}

export function cancelPendingNodeEnrollment(): void {
  const row = db().select().from(fabricMembership).orderBy(asc(fabricMembership.createdAt)).get()
  if (!row) {
    return
  }
  if (row.role !== 'pending-node') {
    throw new AppError({ code: 'fabric_enrollment_not_pending', status: 409, message: 'This Cradle Server already has an active Fabric membership.' })
  }
  db().delete(fabricMembership).where(eq(fabricMembership.fabricId, row.fabricId)).run()
  removeSecret(row.identityKeySecretId)
  removeSecret(row.encryptionKeySecretId)
  notifyFabricMembershipChanged()
}

export function leaveFabric(): void {
  const row = db().select().from(fabricMembership).orderBy(asc(fabricMembership.createdAt)).get()
  if (!row) {
    return
  }
  if (row.role === 'owner') {
    throw new AppError({ code: 'fabric_owner_cannot_leave', status: 409, message: 'The Fabric owner cannot leave its own Fabric.' })
  }
  db().delete(fabricMembership).where(eq(fabricMembership.fabricId, row.fabricId)).run()
  removeSecret(row.identityKeySecretId)
  removeSecret(row.encryptionKeySecretId)
  if (row.ownerKeySecretId) {
    removeSecret(row.ownerKeySecretId)
  }
  notifyFabricMembershipChanged()
}

function hasStoredFabricMembership(): boolean {
  return db().select({ fabricId: fabricMembership.fabricId }).from(fabricMembership).limit(1).get() !== undefined
}

export function requireFabricMembershipSecretRefs(): FabricMembershipSecretRefs {
  const row = db()
    .select({
      ownerKeySecretId: fabricMembership.ownerKeySecretId,
      identityKeySecretId: fabricMembership.identityKeySecretId,
      encryptionKeySecretId: fabricMembership.encryptionKeySecretId,
    })
    .from(fabricMembership)
    .orderBy(asc(fabricMembership.createdAt))
    .get()
  if (!row) {
    throw new AppError({ code: 'fabric_membership_required', status: 409, message: 'This Cradle Server has not joined a Fabric yet.' })
  }
  return row
}

export async function createFabric(input: CreateFabricInput): Promise<FabricMembershipView> {
  if (hasStoredFabricMembership()) {
    throw new AppError({ code: 'fabric_already_configured', status: 409, message: 'This Cradle Server already belongs to a Fabric.' })
  }
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const owner = generateFabricSigningKeyPair()
  const identity = generateFabricSigningKeyPair()
  const encryption = generateFabricEncryptionKeyPair()
  const nodeId = `node_${randomUUID()}`
  const ownerKeySecretId = `fabric-owner-${randomUUID()}`
  const identityKeySecretId = `fabric-identity-${randomUUID()}`
  const encryptionKeySecretId = `fabric-encryption-${randomUUID()}`
  const directory = new FabricDirectoryClient(relayUrl)

  const created = await directory.createFabric(signFabricCreateRequest(owner.privateKeyBase64))
  const nodeCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: created.fabric.fabricId,
    subjectKind: 'node',
subjectId: nodeId,
    identityPubkey: identity.publicKeyBase64,
encryptionPubkey: encryption.publicKeyBase64,
    scopes: ['admin'],
  })
  const controllerCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: created.fabric.fabricId,
    subjectKind: 'controller',
    subjectId: nodeId,
    identityPubkey: identity.publicKeyBase64,
encryptionPubkey: encryption.publicKeyBase64,
    scopes: ['admin', 'approve', 'control', 'view'],
  })
  const deliverySecret = randomFabricSecret()
  const joinRequest = signFabricJoinRequest({
    fabricId: created.fabric.fabricId,
subjectId: nodeId,
identityPrivateKeyBase64: identity.privateKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64,
displayName: localNodeDisplayName(input.displayName),
    platform: input.platform ?? platform(),
version: input.version ?? 'cradle-server',
    capabilities: input.capabilities ?? ['chat', 'workspace', 'terminal'],
deliverySecret,
  })
  const join = await directory.createJoinRequest(joinRequest)
  await directory.approveNodeJoinRequest(join.requestId, nodeCertificate, controllerCertificate, ownerProofHeaders(owner.privateKeyBase64, 'POST', `/v1/join-requests/${join.requestId}/approve`))

  upsertSecret({ id: ownerKeySecretId, kind: 'system-fabric-owner-key', label: 'Cradle Fabric owner key', secret: owner.privateKeyBase64 })
  upsertSecret({ id: identityKeySecretId, kind: 'system-fabric-identity-key', label: 'Cradle Fabric identity key', secret: identity.privateKeyBase64 })
  upsertSecret({ id: encryptionKeySecretId, kind: 'system-fabric-encryption-key', label: 'Cradle Fabric encryption key', secret: encryption.privateKeyBase64 })
  const now = currentUnixSeconds()
  const row = db().insert(fabricMembership).values({
    fabricId: created.fabric.fabricId,
relayUrl,
localNodeId: nodeId,
role: 'owner',
ownerKeySecretId,
    identityKeySecretId,
encryptionKeySecretId,
certificateJson: JSON.stringify({ node: nodeCertificate, controller: controllerCertificate }),
    createdAt: now,
    updatedAt: now,
  }).returning().get()
  notifyFabricMembershipChanged()
  return toView(row)
}

/**
 * Begin enrollment on this Node. The returned object is safe to encode as a
 * QR code; its delivery secret is short-lived and never stored by relayd.
 */
export async function createNodeInvitation(input: CreateFabricInput & { fabricId: string }): Promise<FabricNodeInvitation> {
  if (hasStoredFabricMembership()) {
    throw new AppError({ code: 'fabric_already_configured', status: 409, message: 'This Cradle Server already belongs to a Fabric.' })
  }
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const identity = generateFabricSigningKeyPair()
  const encryption = generateFabricEncryptionKeyPair()
  const nodeId = `node_${randomUUID()}`
  const deliverySecret = randomFabricSecret()
  const request = signFabricJoinRequest({
    fabricId: input.fabricId,
subjectId: nodeId,
identityPrivateKeyBase64: identity.privateKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64,
displayName: localNodeDisplayName(input.displayName),
    platform: input.platform ?? platform(),
version: input.version ?? 'cradle-server',
    capabilities: input.capabilities ?? ['chat', 'workspace', 'terminal'],
deliverySecret,
  })
  const created = await new FabricDirectoryClient(relayUrl).createJoinRequest(request)
  const identityKeySecretId = `fabric-identity-${randomUUID()}`
  const encryptionKeySecretId = `fabric-encryption-${randomUUID()}`
  upsertSecret({ id: identityKeySecretId, kind: 'system-fabric-identity-key', label: 'Cradle Fabric identity key', secret: identity.privateKeyBase64 })
  upsertSecret({ id: encryptionKeySecretId, kind: 'system-fabric-encryption-key', label: 'Cradle Fabric encryption key', secret: encryption.privateKeyBase64 })
  const now = currentUnixSeconds()
  db().insert(fabricMembership).values({
    fabricId: input.fabricId,
relayUrl,
localNodeId: nodeId,
role: 'pending-node',
ownerKeySecretId: null,
    identityKeySecretId,
encryptionKeySecretId,
certificateJson: JSON.stringify({ requestId: created.requestId, deliverySecret, expiresAt: created.expiresAt }),
createdAt: now,
updatedAt: now,
  }).run()
  return { version: 1, relayUrl, fabricId: input.fabricId, requestId: created.requestId, deliverySecret, expiresAt: created.expiresAt }
}

/** Complete a pending Node enrollment after the owner has approved it. */
export async function completeNodeEnrollment(): Promise<FabricMembershipView | null> {
  const row = db().select().from(fabricMembership).orderBy(asc(fabricMembership.createdAt)).get()
  if (!row || row.role !== 'pending-node') {
    return row ? toView(row) : null
  }
  const pending = parsePendingEnrollment(row.certificateJson)
  const result = await new FabricDirectoryClient(row.relayUrl).readJoinRequest(pending.requestId, pending.deliverySecret)
  if (result.status === 'pending') {
    return null
  }
  if (result.status === 'rejected') {
    cancelPendingNodeEnrollment()
    return null
  }
  if (!result.nodeCertificate || !result.controllerCertificate) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 502, message: 'Fabric relay returned an incomplete membership approval.' })
  }
  if (result.nodeCertificate.fabricId !== row.fabricId || result.nodeCertificate.subjectKind !== 'node' || result.nodeCertificate.subjectId !== row.localNodeId) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 502, message: 'Fabric relay returned a mismatched Node certificate.' })
  }
  if (result.controllerCertificate.fabricId !== row.fabricId || result.controllerCertificate.subjectKind !== 'controller' || result.controllerCertificate.subjectId !== row.localNodeId) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 502, message: 'Fabric relay returned a mismatched Controller certificate.' })
  }
  const updated = db().update(fabricMembership).set({
    role: 'node',
    certificateJson: JSON.stringify({ node: result.nodeCertificate, controller: result.controllerCertificate }),
    updatedAt: currentUnixSeconds(),
  }).where(eq(fabricMembership.fabricId, row.fabricId)).returning().get()
  if (!updated) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 500, message: 'Fabric membership disappeared during enrollment.' })
  }
  notifyFabricMembershipChanged()
  return toView(updated)
}

export async function approveNodeInvitation(invitation: FabricNodeInvitation): Promise<NodeSummary> {
  const membership = requireFabricMembership()
  requireOwnerKey()
  if (invitation.fabricId !== membership.fabricId || invitation.relayUrl !== membership.relayUrl) {
    throw new AppError({ code: 'fabric_invitation_wrong_fabric', status: 409, message: 'This Node invitation belongs to a different Fabric.' })
  }
  const directory = new FabricDirectoryClient(membership.relayUrl)
  const pending = await directory.readJoinRequest(invitation.requestId, invitation.deliverySecret)
  if (pending.status === 'approved') {
    throw new AppError({ code: 'fabric_invitation_already_approved', status: 409, message: 'This Node invitation has already been approved.' })
  }
  if (pending.status === 'rejected') {
    throw new AppError({ code: 'fabric_invitation_rejected', status: 409, message: 'This Node invitation was rejected.' })
  }
  if (pending.request.subjectKind !== 'node') {
    throw new AppError({ code: 'fabric_invitation_subject_invalid', status: 409, message: 'This invitation belongs to a Controller, not a Node.' })
  }
  return await approveJoinRequest(pending.request)
}

export async function listPendingNodeRequests(): Promise<PendingFabricNodeRequestView[]> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/fabrics/${membership.fabricId}/join-requests`
  const requests = await new FabricDirectoryClient(membership.relayUrl).listJoinRequests(
    membership.fabricId,
    ownerProofHeaders(ownerPrivateKey, 'GET', path),
  )
  return requests.filter(request => request.subjectKind === 'node').map(request => ({
    requestId: request.requestId,
    displayName: request.displayName,
    platform: request.platform,
    version: request.version,
    capabilities: request.capabilities,
    requestedAt: new Date(request.issuedAt * 1000).toISOString(),
    expiresAt: new Date(request.expiresAt * 1000).toISOString(),
  }))
}

export async function approvePendingNodeRequest(requestId: string): Promise<NodeSummary> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/fabrics/${membership.fabricId}/join-requests`
  const requests = await new FabricDirectoryClient(membership.relayUrl).listJoinRequests(
    membership.fabricId,
    ownerProofHeaders(ownerPrivateKey, 'GET', path),
  )
  const request = requests.find(candidate => candidate.requestId === requestId && candidate.subjectKind === 'node')
  if (!request) {
    throw new AppError({ code: 'fabric_join_request_not_found', status: 404, message: 'This Fabric join request is no longer pending.' })
  }
  return await approveJoinRequest(request)
}

export async function listPendingControllerRequests(): Promise<PendingFabricControllerRequestView[]> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/fabrics/${membership.fabricId}/join-requests`
  const requests = await new FabricDirectoryClient(membership.relayUrl).listJoinRequests(
    membership.fabricId,
    ownerProofHeaders(ownerPrivateKey, 'GET', path),
  )
  return requests.filter(request => request.subjectKind === 'controller').map(request => ({
    requestId: request.requestId,
    subjectId: request.subjectId,
    identityPubkey: request.identityPubkey,
    encryptionPubkey: request.encryptionPubkey,
    displayName: request.displayName,
    platform: request.platform,
    version: request.version,
    capabilities: request.capabilities,
    requestedAt: new Date(request.issuedAt * 1000).toISOString(),
    expiresAt: new Date(request.expiresAt * 1000).toISOString(),
  }))
}

export async function approvePendingControllerRequest(
  requestId: string,
  input: { nodeId: string, scopes: FabricScope[] },
): Promise<{ fabricId: string, controllerId: string }> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const allowedScopes = new Set<FabricScope>(['view', 'control', 'approve'])
  const scopes = [...new Set(input.scopes)]
  if (scopes.length === 0 || scopes.some(scope => !allowedScopes.has(scope))) {
    throw new AppError({ code: 'fabric_controller_scopes_invalid', status: 400, message: 'Controller enrollment requires view, control, or approve scopes.' })
  }
  await getNode(input.nodeId)
  const listPath = `/v1/fabrics/${membership.fabricId}/join-requests`
  const requests = await new FabricDirectoryClient(membership.relayUrl).listJoinRequests(
    membership.fabricId,
    ownerProofHeaders(ownerPrivateKey, 'GET', listPath),
  )
  const request = requests.find(candidate => candidate.requestId === requestId && candidate.subjectKind === 'controller')
  if (!request) {
    throw new AppError({ code: 'fabric_join_request_not_found', status: 404, message: 'This Controller enrollment request is no longer pending.' })
  }
  const certificate = signFabricCertificate(ownerPrivateKey, {
    fabricId: membership.fabricId,
    subjectKind: 'controller',
    subjectId: request.subjectId,
    identityPubkey: request.identityPubkey,
    encryptionPubkey: request.encryptionPubkey,
    nodeId: input.nodeId,
    scopes,
  })
  const grants: FabricNodeGrant[] = scopes.map(scope => ({
    grantId: `grant_${randomUUID()}`,
    fabricId: membership.fabricId,
    controllerId: request.subjectId,
    nodeId: input.nodeId,
    scope,
  }))
  const path = `/v1/join-requests/${request.requestId}/approve`
  return await new FabricDirectoryClient(membership.relayUrl).approveControllerJoinRequest(
    request.requestId,
    certificate,
    grants,
    ownerProofHeaders(ownerPrivateKey, 'POST', path),
  )
}

export async function rejectPendingNodeRequest(requestId: string): Promise<void> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/fabrics/${membership.fabricId}/join-requests/${requestId}`
  await new FabricDirectoryClient(membership.relayUrl).rejectJoinRequest(
    membership.fabricId,
    requestId,
    ownerProofHeaders(ownerPrivateKey, 'DELETE', path),
  )
}

async function approveJoinRequest(request: FabricJoinRequest): Promise<NodeSummary> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  if (request.fabricId !== membership.fabricId) {
    throw new AppError({ code: 'fabric_invitation_wrong_fabric', status: 409, message: 'This Node invitation belongs to a different Fabric.' })
  }
  if (request.subjectKind !== 'node') {
    throw new AppError({ code: 'fabric_invitation_subject_invalid', status: 409, message: 'Only Node join requests can use Node approval.' })
  }
  const nodeCertificate = signFabricCertificate(ownerPrivateKey, {
    fabricId: membership.fabricId,
subjectKind: 'node',
subjectId: request.subjectId,
    identityPubkey: request.identityPubkey,
encryptionPubkey: request.encryptionPubkey,
scopes: ['admin'],
  })
  const controllerCertificate = signFabricCertificate(ownerPrivateKey, {
    fabricId: membership.fabricId,
    subjectKind: 'controller',
    subjectId: request.subjectId,
    identityPubkey: request.identityPubkey,
    encryptionPubkey: request.encryptionPubkey,
    scopes: ['admin', 'approve', 'control', 'view'],
  })
  const directory = new FabricDirectoryClient(membership.relayUrl)
  return await directory.approveNodeJoinRequest(request.requestId, nodeCertificate, controllerCertificate, ownerProofHeaders(ownerPrivateKey, 'POST', `/v1/join-requests/${request.requestId}/approve`))
}

export async function listNodes(): Promise<NodeSummary[]> {
  const membership = requireFabricMembership()
  return await new FabricDirectoryClient(membership.relayUrl).listNodes(membership.fabricId, controllerHeaders(membership, 'GET', `/v1/fabrics/${membership.fabricId}/nodes`))
}

/**
 * Read one Node's last-known directory summary. Offline Nodes remain visible
 * because relayd persists Node records; presence is only a status field.
 */
export async function getNode(nodeId: string): Promise<NodeSummary> {
  const nodes = await listNodes()
  const node = nodes.find(candidate => candidate.nodeId === nodeId)
  if (!node) {
    throw new AppError({ code: 'fabric_node_not_found', status: 404, message: 'This Node is not visible to this Cradle Server Fabric membership.' })
  }
  return node
}

/** List every grant recorded for a Node, including revoked rows. Owner-only. */
export async function listNodeGrants(nodeId: string): Promise<FabricNodeGrant[]> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/nodes/${nodeId}/grants`
  return await new FabricDirectoryClient(membership.relayUrl).listNodeGrants(nodeId, ownerProofHeaders(ownerPrivateKey, 'GET', path))
}

/** Revoke one Controller grant. relayd closes matching live links immediately. */
export async function revokeNodeGrant(nodeId: string, grantId: string): Promise<void> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/nodes/${nodeId}/grants/${grantId}`
  await new FabricDirectoryClient(membership.relayUrl).revokeNodeGrant(nodeId, grantId, ownerProofHeaders(ownerPrivateKey, 'DELETE', path))
}

/** Permanently remove a remote device and all of its Node/Controller access. */
export async function removeNode(nodeId: string): Promise<void> {
  const membership = requireFabricMembership()
  if (nodeId === membership.localNodeId) {
    throw new AppError({ code: 'fabric_local_node_cannot_be_removed', status: 409, message: 'The Fabric owner cannot remove this device from itself.' })
  }
  const ownerPrivateKey = requireOwnerKey()
  const path = `/v1/nodes/${nodeId}`
  await new FabricDirectoryClient(membership.relayUrl).removeNode(nodeId, ownerProofHeaders(ownerPrivateKey, 'DELETE', path))
}

export async function openNodeLink(nodeId: string): Promise<{ linkId: string, expiresAt: string, nodeCertificate: MembershipCertificate }> {
  const membership = requireFabricMembership()
  const link = await new FabricDirectoryClient(membership.relayUrl).openLink(nodeId, controllerHeaders(membership, 'POST', `/v1/nodes/${nodeId}/links`))
  assertFabricCertificate(link.nodeCertificate, membership.ownerPubkey, membership.fabricId)
  if (link.nodeCertificate.subjectKind !== 'node' || link.nodeCertificate.subjectId !== nodeId) {
    throw new AppError({
      code: 'fabric_node_certificate_invalid',
      status: 502,
      message: `Fabric relay returned a certificate for ${link.nodeCertificate.subjectKind}/${link.nodeCertificate.subjectId}, expected node/${nodeId}.`,
    })
  }
  return link
}

/**
 * Restore this owner's Controller record at the relay. This is idempotent and
 * lets a relay recover membership records created before Node and Controller
 * certificates were persisted independently.
 */
export async function registerLocalFabricController(): Promise<boolean> {
  const membership = requireFabricMembership()
  const secretRefs = requireFabricMembershipSecretRefs()
  if (!secretRefs.ownerKeySecretId) {
    return false
  }
  const path = `/v1/fabrics/${membership.fabricId}/controllers`
  await new FabricDirectoryClient(membership.relayUrl).registerController(
    membership.fabricId,
    membership.controllerCertificate,
    [],
    ownerProofHeaders(readSecret(secretRefs.ownerKeySecretId), 'POST', path),
  )
  return true
}

export type FabricControllerMembershipView = FabricMembershipView & { controllerCertificate: MembershipCertificate }

export function requireFabricMembership(): FabricControllerMembershipView {
  const membership = getFabricMembership()
  if (!membership || membership.role === 'pending-node' || !membership.controllerCertificate) {
    throw new AppError({ code: 'fabric_membership_required', status: 409, message: 'This Cradle Server has not joined a Fabric yet.' })
  }
  return { ...membership, controllerCertificate: membership.controllerCertificate }
}

function controllerHeaders(membership: FabricMembershipView, method: string, path: string): Headers {
  const secretRefs = requireFabricMembershipSecretRefs()
  if (!membership.controllerCertificate) {
    throw new AppError({ code: 'fabric_controller_required', status: 403, message: 'This Fabric membership is Node-only.' })
  }
  return fabricAuthHeaders(membership.controllerCertificate, readSecret(secretRefs.identityKeySecretId), method, path)
}

function requireOwnerKey(): string {
  const secretRefs = requireFabricMembershipSecretRefs()
  if (!secretRefs.ownerKeySecretId) { throw new AppError({ code: 'fabric_owner_required', status: 403, message: 'Only the Fabric owner can manage devices.' }) }
  return readSecret(secretRefs.ownerKeySecretId)
}

function toView(row: typeof fabricMembership.$inferSelect): FabricMembershipView {
  const certificates = JSON.parse(row.certificateJson) as StoredCertificates
  if (!certificates.node) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 500, message: 'Fabric membership has not completed enrollment.' })
  }
  return { fabricId: row.fabricId, relayUrl: row.relayUrl, localNodeId: row.localNodeId, role: row.role, ownerPubkey: certificates.node.issuerPubkey, nodeCertificate: certificates.node, ...(certificates.controller ? { controllerCertificate: certificates.controller } : {}), createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function normalizeRelayUrl(value: string): string {
  try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) { throw new Error('Unsupported relay URL protocol') } return parsed.toString().replace(/\/$/, '') }
 catch { throw new AppError({ code: 'fabric_relay_url_invalid', status: 400, message: 'Fabric relay URL must be an HTTP or HTTPS URL.' }) }
}

function parsePendingEnrollment(value: string): { requestId: string, deliverySecret: string, expiresAt?: string } {
  const pending = JSON.parse(value) as StoredPendingEnrollment
  if (!pending.requestId || !pending.deliverySecret) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 500, message: 'Pending Fabric enrollment is missing its delivery credentials.' })
  }
  return {
    requestId: pending.requestId,
    deliverySecret: pending.deliverySecret,
    ...(pending.expiresAt ? { expiresAt: pending.expiresAt } : {}),
  }
}
