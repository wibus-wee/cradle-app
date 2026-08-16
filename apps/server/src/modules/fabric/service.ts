import { randomUUID } from 'node:crypto'
import { hostname, platform } from 'node:os'

import { fabricMembership } from '@cradle/db'
import { asc, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { readSecret, upsertSecret } from '../secrets/service'
import { FabricDirectoryClient } from './directory-client'
import {
  fabricAuthHeaders,
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  ownerProofHeaders,
  randomFabricSecret,
  assertFabricCertificate,
  signFabricCertificate,
  signFabricCreateRequest,
  signFabricJoinRequest,
  type MembershipCertificate,
  type NodeSummary,
} from './protocol'

interface StoredCertificates {
  node: MembershipCertificate
  controller: MembershipCertificate
}

export interface FabricMembershipView {
  fabricId: string
  relayUrl: string
  localNodeId: string
  role: string
  ownerPubkey: string
  nodeCertificate: MembershipCertificate
  controllerCertificate: MembershipCertificate
  createdAt: number
  updatedAt: number
}

export interface FabricNodeInvitation {
  version: 1
  relayUrl: string
  fabricId: string
  requestId: string
  deliverySecret: string
  expiresAt: string
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
  return row ? toView(row) : null
}

export async function createFabric(input: CreateFabricInput): Promise<FabricMembershipView> {
  if (getFabricMembership()) {
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
    subjectKind: 'node', subjectId: nodeId,
    identityPubkey: identity.publicKeyBase64, encryptionPubkey: encryption.publicKeyBase64,
    scopes: ['admin'],
  })
  const controllerCertificate = signFabricCertificate(owner.privateKeyBase64, {
    fabricId: created.fabric.fabricId,
    subjectKind: 'controller', subjectId: nodeId,
    identityPubkey: identity.publicKeyBase64, encryptionPubkey: encryption.publicKeyBase64,
    scopes: ['admin', 'approve', 'control', 'view'],
  })
  const deliverySecret = randomFabricSecret()
  const joinRequest = signFabricJoinRequest({
    fabricId: created.fabric.fabricId, subjectId: nodeId, identityPrivateKeyBase64: identity.privateKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64, displayName: input.displayName?.trim() || hostname(),
    platform: input.platform ?? platform(), version: input.version ?? 'cradle-server',
    capabilities: input.capabilities ?? ['chat', 'workspace', 'terminal'], deliverySecret,
  })
  const join = await directory.createJoinRequest(joinRequest)
  await directory.approveJoinRequest(join.requestId, nodeCertificate, ownerProofHeaders(owner.privateKeyBase64, 'POST', `/v1/join-requests/${join.requestId}/approve`))
  await directory.registerController(created.fabric.fabricId, controllerCertificate, [{
    grantId: `grant_${randomUUID()}`, fabricId: created.fabric.fabricId, controllerId: nodeId, nodeId, scope: 'admin',
  }], ownerProofHeaders(owner.privateKeyBase64, 'POST', `/v1/fabrics/${created.fabric.fabricId}/controllers`))

  upsertSecret({ id: ownerKeySecretId, kind: 'system-fabric-owner-key', label: 'Cradle Fabric owner key', secret: owner.privateKeyBase64 })
  upsertSecret({ id: identityKeySecretId, kind: 'system-fabric-identity-key', label: 'Cradle Fabric identity key', secret: identity.privateKeyBase64 })
  upsertSecret({ id: encryptionKeySecretId, kind: 'system-fabric-encryption-key', label: 'Cradle Fabric encryption key', secret: encryption.privateKeyBase64 })
  const now = currentUnixSeconds()
  const row = db().insert(fabricMembership).values({
    fabricId: created.fabric.fabricId, relayUrl, localNodeId: nodeId, role: 'owner', ownerKeySecretId,
    identityKeySecretId, encryptionKeySecretId, certificateJson: JSON.stringify({ node: nodeCertificate, controller: controllerCertificate }),
    createdAt: now, updatedAt: now,
  }).returning().get()
  return toView(row)
}

/** Begin enrollment on this Node. The returned object is safe to encode as a
 * QR code; its delivery secret is short-lived and never stored by relayd. */
export async function createNodeInvitation(input: CreateFabricInput & { fabricId: string }): Promise<FabricNodeInvitation> {
  if (getFabricMembership()) {
    throw new AppError({ code: 'fabric_already_configured', status: 409, message: 'This Cradle Server already belongs to a Fabric.' })
  }
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const identity = generateFabricSigningKeyPair()
  const encryption = generateFabricEncryptionKeyPair()
  const nodeId = `node_${randomUUID()}`
  const deliverySecret = randomFabricSecret()
  const request = signFabricJoinRequest({
    fabricId: input.fabricId, subjectId: nodeId, identityPrivateKeyBase64: identity.privateKeyBase64,
    encryptionPubkey: encryption.publicKeyBase64, displayName: input.displayName?.trim() || hostname(),
    platform: input.platform ?? platform(), version: input.version ?? 'cradle-server',
    capabilities: input.capabilities ?? ['chat', 'workspace', 'terminal'], deliverySecret,
  })
  const created = await new FabricDirectoryClient(relayUrl).createJoinRequest(request)
  const identityKeySecretId = `fabric-identity-${randomUUID()}`
  const encryptionKeySecretId = `fabric-encryption-${randomUUID()}`
  upsertSecret({ id: identityKeySecretId, kind: 'system-fabric-identity-key', label: 'Cradle Fabric identity key', secret: identity.privateKeyBase64 })
  upsertSecret({ id: encryptionKeySecretId, kind: 'system-fabric-encryption-key', label: 'Cradle Fabric encryption key', secret: encryption.privateKeyBase64 })
  const now = currentUnixSeconds()
  db().insert(fabricMembership).values({
    fabricId: input.fabricId, relayUrl, localNodeId: nodeId, role: 'pending-node', ownerKeySecretId: null,
    identityKeySecretId, encryptionKeySecretId, certificateJson: JSON.stringify({ requestId: created.requestId, deliverySecret }), createdAt: now, updatedAt: now,
  }).run()
  return { version: 1, relayUrl, fabricId: input.fabricId, requestId: created.requestId, deliverySecret, expiresAt: created.expiresAt }
}

export async function approveNodeInvitation(invitation: FabricNodeInvitation): Promise<NodeSummary> {
  const membership = requireFabricMembership()
  const ownerPrivateKey = requireOwnerKey(membership)
  if (invitation.fabricId !== membership.fabricId || invitation.relayUrl !== membership.relayUrl) {
    throw new AppError({ code: 'fabric_invitation_wrong_fabric', status: 409, message: 'This Node invitation belongs to a different Fabric.' })
  }
  const directory = new FabricDirectoryClient(membership.relayUrl)
  const pending = await directory.readJoinRequest(invitation.requestId, invitation.deliverySecret)
  if (pending.status === 'approved') {
    throw new AppError({ code: 'fabric_invitation_already_approved', status: 409, message: 'This Node invitation has already been approved.' })
  }
  const request = pending.request
  const nodeCertificate = signFabricCertificate(ownerPrivateKey, {
    fabricId: membership.fabricId, subjectKind: 'node', subjectId: requiredString(request, 'subjectId'),
    identityPubkey: requiredString(request, 'identityPubkey'), encryptionPubkey: requiredString(request, 'encryptionPubkey'), scopes: ['admin'],
  })
  return await directory.approveJoinRequest(invitation.requestId, nodeCertificate, ownerProofHeaders(ownerPrivateKey, 'POST', `/v1/join-requests/${invitation.requestId}/approve`))
}

export async function listNodes(): Promise<NodeSummary[]> {
  const membership = requireFabricMembership()
  return await new FabricDirectoryClient(membership.relayUrl).listNodes(membership.fabricId, controllerHeaders(membership, 'GET', `/v1/fabrics/${membership.fabricId}/nodes`))
}

export async function openNodeLink(nodeId: string): Promise<{ linkId: string, expiresAt: string, nodeCertificate: MembershipCertificate }> {
  const membership = requireFabricMembership()
  const link = await new FabricDirectoryClient(membership.relayUrl).openLink(nodeId, controllerHeaders(membership, 'POST', `/v1/nodes/${nodeId}/links`))
  assertFabricCertificate(link.nodeCertificate, membership.ownerPubkey, membership.fabricId)
  if (link.nodeCertificate.subjectKind !== 'node' || link.nodeCertificate.subjectId !== nodeId) throw new AppError({ code: 'fabric_node_certificate_invalid', status: 502, message: 'Fabric relay returned a mismatched Node certificate.' })
  return link
}

export function requireFabricMembership(): FabricMembershipView {
  const membership = getFabricMembership()
  if (!membership || membership.role === 'pending-node') {
    throw new AppError({ code: 'fabric_membership_required', status: 409, message: 'This Cradle Server has not joined a Fabric yet.' })
  }
  return membership
}

function controllerHeaders(membership: FabricMembershipView, method: string, path: string): Headers {
  return fabricAuthHeaders(membership.controllerCertificate, readSecret(membership.identityKeySecretId), method, path)
}

function requireOwnerKey(membership: FabricMembershipView): string {
  if (!membership.ownerKeySecretId) throw new AppError({ code: 'fabric_owner_required', status: 403, message: 'Only the Fabric owner can approve Nodes.' })
  return readSecret(membership.ownerKeySecretId)
}

function toView(row: typeof fabricMembership.$inferSelect): FabricMembershipView {
  const certificates = JSON.parse(row.certificateJson) as StoredCertificates
  if (!certificates.node || !certificates.controller) {
    throw new AppError({ code: 'fabric_membership_invalid', status: 500, message: 'Fabric membership has not completed enrollment.' })
  }
  return { fabricId: row.fabricId, relayUrl: row.relayUrl, localNodeId: row.localNodeId, role: row.role, ownerPubkey: certificates.node.issuerPubkey, nodeCertificate: certificates.node, controllerCertificate: certificates.controller, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function normalizeRelayUrl(value: string): string {
  try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); return parsed.toString().replace(/\/$/, '') } catch { throw new AppError({ code: 'fabric_relay_url_invalid', status: 400, message: 'Fabric relay URL must be an HTTP or HTTPS URL.' }) }
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) throw new AppError({ code: 'fabric_invitation_invalid', status: 400, message: `Node invitation is missing ${field}.` })
  return result
}
