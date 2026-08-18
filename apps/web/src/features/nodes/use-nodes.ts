import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  deleteFabricNodeInvitationsPendingMutation,
  deleteNodesByNodeIdGrantsByGrantIdMutation,
  getFabricManagedRelayOptions,
  getFabricNodeInvitationsPendingOptions,
  getFabricNodeInvitationsPendingQueryKey,
  getFabricOptions,
  getFabricQueryKey,
  getNodesByNodeIdGrantsOptions,
  getNodesByNodeIdGrantsQueryKey,
  getNodesOptions,
  getNodesQueryKey,
  postFabricMutation,
  postFabricNodeInvitationsApproveMutation,
  postFabricNodeInvitationsCompleteMutation,
  postFabricNodeInvitationsMutation,
  postNodesByNodeIdConnectMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetFabricResponse, GetWorkspacesResponse } from '~/api-gen/types.gen'

import type { NodeWorkspaceSummary } from './node-grouping'
import { resolveNodeDisplayName } from './node-grouping'
import type { FabricNode, FabricNodeInvitation } from './types'
import { nodeUpstreamQueryOptions } from './upstream-fetch'

/** This device's Fabric membership, or `null` when unenrolled. */
export function useFabricMembership() {
  return useQuery({ ...getFabricOptions(), staleTime: 30_000 })
}

/** Current Relay endpoint used when creating the first Fabric. */
export function useManagedRelay() {
  return useQuery({ ...getFabricManagedRelayOptions(), staleTime: 30_000 })
}

/** Enrollment this device is waiting for an existing Fabric owner to approve. */
export function usePendingFabricEnrollment() {
  return useQuery({ ...getFabricNodeInvitationsPendingOptions(), staleTime: 3_000 })
}

/** Nodes visible in this Fabric (`GET /nodes`). */
export function useNodes() {
  return useQuery({ ...getNodesOptions(), staleTime: 15_000 })
}

/** Resolve a Node display name from the cached directory (no extra request). */
export function useNodeDisplayName(nodeId: string | null | undefined): string | null {
  const { data: nodes } = useNodes()
  return resolveNodeDisplayName(nodes ?? [], nodeId)
}

function useRefreshFabric() {
  const queryClient = useQueryClient()
  return useCallback(
    async (membership?: GetFabricResponse) => {
      if (membership) {
        queryClient.setQueryData(getFabricQueryKey(), membership)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getFabricQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getFabricNodeInvitationsPendingQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
      ])
    },
    [queryClient],
  )
}

/** Create a Cradle Fabric and enroll this device as its first Node. */
export function useCreateFabric() {
  const refresh = useRefreshFabric()
  return useMutation({
    ...postFabricMutation(),
    onSuccess: membership => refresh(membership),
  })
}

/**
 * Begin enrolling this device into an existing Fabric. The returned invitation
 * string contains a short-lived secret. The local pending-enrollment endpoint
 * can restore it after a restart so the user can finish or cancel the flow.
 */
export function useCreateNodeInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    ...postFabricNodeInvitationsMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getFabricNodeInvitationsPendingQueryKey() }),
  })
}

/** Cancel this device's pending enrollment without affecting an active membership. */
export function useCancelPendingFabricEnrollment() {
  const refresh = useRefreshFabric()
  return useMutation({
    ...deleteFabricNodeInvitationsPendingMutation(),
    onSuccess: () => refresh(),
  })
}

/** Poll completion of an owner-approved enrollment on this device. */
export function useCompleteNodeEnrollment() {
  const refresh = useRefreshFabric()
  return useMutation({
    ...postFabricNodeInvitationsCompleteMutation(),
    onSuccess: membership => refresh(membership),
  })
}

/** Owner-side: approve a pasted Node invitation string. */
export function useApproveNodeInvitation() {
  const refresh = useRefreshFabric()
  return useMutation({
    ...postFabricNodeInvitationsApproveMutation(),
    onSuccess: () => refresh(),
  })
}

/** Open (or reuse) an encrypted link to a Node. Idempotent. */
export function useConnectNode() {
  return useMutation({ ...postNodesByNodeIdConnectMutation() })
}

/** Controller grants recorded on a Node (`GET /nodes/:nodeId/grants`, owner-only). */
export function useNodeGrants(nodeId: string | null) {
  return useQuery({
    ...getNodesByNodeIdGrantsOptions({ path: { nodeId: nodeId ?? '' } }),
    enabled: nodeId !== null,
    retry: false,
    staleTime: 15_000,
  })
}

/**
 * Revoke a Controller grant on a Node. relayd closes matching live links
 * immediately; the local caches refresh from the directory afterwards.
 */
export function useRevokeNodeGrant() {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteNodesByNodeIdGrantsByGrantIdMutation(),
    onSuccess: (_data, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getNodesByNodeIdGrantsQueryKey({ path: { nodeId: variables.path.nodeId } }),
        }),
      ]),
  })
}

function toNodeWorkspaceSummary(workspace: GetWorkspacesResponse[number]): NodeWorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.locator.path,
    kind: workspace.locator.kind,
    originUrl: workspace.gitIdentity.originUrl ?? null,
    repoRoot: workspace.gitIdentity.repoRoot ?? null,
  }
}

/** Fetch a Node's workspace summaries on demand over its link. */
export function useNodeWorkspaces(node: FabricNode | null, enabled: boolean) {
  const nodeId = node?.nodeId ?? ''
  return useQuery({
    ...nodeUpstreamQueryOptions<GetWorkspacesResponse>(nodeId, '/workspaces', ['workspaces']),
    enabled: enabled && node !== null && node.status === 'online',
    select: workspaces => workspaces.map(toNodeWorkspaceSummary),
    staleTime: 30_000,
  })
}

export type { FabricNodeInvitation }
