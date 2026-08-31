import type {
  FabricJoinRequest,
  MembershipCertificate,
  NodeSummary,
} from '@cradle/fabric-protocol'

export const FABRIC_STORAGE_SCHEMA_VERSION = 1 as const

export interface FabricPairingCode {
  version: 1
  relayUrl: string
  fabricId: string
  ownerPubkey: string
}

export interface PendingFabricControllerEnrollment {
  pairing: FabricPairingCode
  request: FabricJoinRequest
  expiresAt: string
  createdAt: string
}

export interface FabricDirectorySnapshot {
  revision: number
  nodes: NodeSummary[]
  fetchedAt: string
}

export interface MobileFabricMembership {
  schemaVersion: typeof FABRIC_STORAGE_SCHEMA_VERSION
  relayUrl: string
  fabricId: string
  ownerPubkey: string
  controllerId: string
  controllerCertificate: MembershipCertificate
  directory: FabricDirectorySnapshot
  selectedNodeId: string | null
  createdAt: string
  updatedAt: string
}

export interface FabricMetadataState {
  schemaVersion: typeof FABRIC_STORAGE_SCHEMA_VERSION
  pending: PendingFabricControllerEnrollment | null
  membership: MobileFabricMembership | null
}

export interface FabricSecretState {
  schemaVersion: typeof FABRIC_STORAGE_SCHEMA_VERSION
  identityPrivateKeyBase64: string
  encryptionPrivateKeyBase64: string
  pendingDeliverySecret: string | null
}

export interface FabricControllerDescriptor {
  displayName: string
  platform: string
  version: string
  capabilities: string[]
}

export interface FabricEnrollmentDraft {
  pending: PendingFabricControllerEnrollment
  secrets: FabricSecretState
}

export type FabricEnrollmentPollResult
  = | { status: 'pending' }
    | { status: 'rejected', rejectedAt: string | null }
    | { status: 'approved', membership: MobileFabricMembership }
