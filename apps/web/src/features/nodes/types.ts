import type {
  GetFabricControllerInvitationsRequestsResponse,
  GetFabricNodeInvitationsPendingResponse,
  GetFabricNodeInvitationsRequestsResponse,
  GetFabricResponse,
  GetNodesResponse,
  PostFabricNodeInvitationsResponse,
} from '~/api-gen/types.gen'

/** One Node summary from `GET /nodes`. */
export type FabricNode = GetNodesResponse[number]

/** Local Fabric membership from `GET /fabric` (null when this device is unenrolled). */
export type FabricMembership = NonNullable<GetFabricResponse>

/** One-time Node enrollment invitation from `POST /fabric/node-invitations`. */
export type FabricNodeInvitation = PostFabricNodeInvitationsResponse

/** Local Node enrollment waiting for approval from an existing Fabric owner. */
export type PendingFabricEnrollment = NonNullable<GetFabricNodeInvitationsPendingResponse>

/** One owner-visible Node enrollment request waiting for a decision. */
export type PendingFabricNodeRequest = GetFabricNodeInvitationsRequestsResponse[number]

/** One owner-visible Controller enrollment request waiting for scoped grants. */
export type PendingFabricControllerRequest = GetFabricControllerInvitationsRequestsResponse[number]

export const CONTROLLER_GRANT_SCOPES = ['view', 'control', 'approve'] as const
export type ControllerGrantScope = (typeof CONTROLLER_GRANT_SCOPES)[number]

export interface ControllerGrantSelection {
  nodeId: string
  scopes: ControllerGrantScope[]
}

/**
 * Fabric grant scopes, ordered from least to most privileged.
 * `control` does not imply `approve` (Plan 076, Decision Log).
 */
export const NODE_GRANT_SCOPES = ['view', 'control', 'approve', 'admin'] as const
export type NodeGrantScope = (typeof NODE_GRANT_SCOPES)[number]

/**
 * A grant a Controller holds over a Node.
 *
 * The Server proxies these records from relayd's Fabric directory and owns the
 * access-management surface exposed to the Web app.
 */
export interface NodeGrant {
  grantId: string
  controllerId: string
  controllerLabel: string
  nodeId: string
  scope: NodeGrantScope
  revokedAt: string | null
}

/** Approved Controller access grouped across the Fabric's Nodes. */
export interface FabricControllerAccess {
  controllerId: string
  displayName: string
  grants: NodeGrant[]
}

/** Access level this device holds over a Node, derived from grants. */
export interface NodeAccess {
  scope: NodeGrantScope | null
  canView: boolean
  canControl: boolean
  canApprove: boolean
  canAdmin: boolean
}

export const FULL_NODE_ACCESS: NodeAccess = {
  scope: 'admin',
  canView: true,
  canControl: true,
  canApprove: true,
  canAdmin: true,
}

export const VIEW_ONLY_NODE_ACCESS: NodeAccess = {
  scope: 'view',
  canView: true,
  canControl: false,
  canApprove: false,
  canAdmin: false,
}
