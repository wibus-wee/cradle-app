import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import {
  deleteFabricControllerInvitationsRequestsByRequestIdMutation,
  deleteFabricControllersByControllerIdMutation,
  deleteFabricMutation,
  deleteFabricNodeInvitationsPendingMutation,
  deleteFabricNodeInvitationsRequestsByRequestIdMutation,
  deleteNodesByNodeIdGrantsByGrantIdMutation,
  deleteNodesByNodeIdMutation,
  getFabricControllerInvitationsRequestsOptions,
  getFabricControllerInvitationsRequestsQueryKey,
  getFabricManagedRelayOptions,
  getFabricNodeInvitationsPendingOptions,
  getFabricNodeInvitationsPendingQueryKey,
  getFabricNodeInvitationsRequestsOptions,
  getFabricNodeInvitationsRequestsQueryKey,
  getFabricOptions,
  getFabricQueryKey,
  getNodesByNodeIdGrantsOptions,
  getNodesByNodeIdGrantsQueryKey,
  getNodesOptions,
  getNodesQueryKey,
  patchFabricRelayUrlMutation,
  postFabricControllerInvitationsRequestsByRequestIdApproveMutation,
  postFabricMutation,
  postFabricNodeInvitationsApproveMutation,
  postFabricNodeInvitationsCompleteMutation,
  postFabricNodeInvitationsMutation,
  postFabricNodeInvitationsRequestsByRequestIdApproveMutation,
  postNodesByNodeIdConnectMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetFabricResponse, GetWorkspacesResponse } from '~/api-gen/types.gen'

import type { NodeWorkspaceSummary } from './node-grouping'
import { resolveNodeDisplayName } from './node-grouping'
import type { FabricNode, FabricNodeInvitation } from './types'
import { nodeUpstreamQueryOptions } from './upstream-fetch'

/** This device's Fabric membership, or `null` when unenrolled. */
export function useFabricMembership(enabled = true) {
  return useQuery({ ...getFabricOptions(), enabled, staleTime: 30_000 })
}

/** Current Relay endpoint used when creating the first Fabric. */
export function useManagedRelay() {
  return useQuery({ ...getFabricManagedRelayOptions(), staleTime: 30_000 })
}

/** Update this device's saved Fabric Relay URL without changing its membership. */
export function useUpdateFabricRelayUrl() {
  const queryClient = useQueryClient()
  return useMutation({
    ...patchFabricRelayUrlMutation(),
    onSuccess: membership => queryClient.setQueryData(getFabricQueryKey(), membership),
  })
}

/** Enrollment this device is waiting for an existing Fabric owner to approve. */
export function usePendingFabricEnrollment() {
  return useQuery({ ...getFabricNodeInvitationsPendingOptions(), staleTime: 3_000 })
}

/** Owner inbox for pending Node enrollment requests. */
export function usePendingFabricNodeRequests(enabled: boolean) {
  return useQuery({
    ...getFabricNodeInvitationsRequestsOptions(),
    enabled,
    retry: false,
    refetchInterval: enabled ? 3_000 : false,
  })
}

/** Owner inbox for pending Controller enrollment requests. */
export function usePendingFabricControllerRequests(enabled: boolean) {
  return useQuery({
    ...getFabricControllerInvitationsRequestsOptions(),
    enabled,
    retry: false,
    refetchInterval: enabled ? 3_000 : false,
  })
}

/** Nodes visible in this Fabric (`GET /nodes`). */
export function useNodes(enabled = true) {
  return useQuery({
    ...getNodesOptions(),
    enabled,
    staleTime: 3_000,
    refetchInterval: enabled ? 3_000 : false,
  })
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

/** Remove this non-owner device's active local Fabric membership. */
export function useLeaveFabric() {
  const refresh = useRefreshFabric()
  return useMutation({
    ...deleteFabricMutation(),
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

/** Owner-side: approve one request directly from the Fabric inbox. */
export function useApprovePendingFabricNodeRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    ...postFabricNodeInvitationsRequestsByRequestIdApproveMutation(),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: getFabricNodeInvitationsRequestsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
    ]),
  })
}

/** Owner-side: reject one request from the Fabric inbox. */
export function useRejectPendingFabricNodeRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteFabricNodeInvitationsRequestsByRequestIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getFabricNodeInvitationsRequestsQueryKey() }),
  })
}

/** Owner-side: approve explicit per-Node grants for a pending Controller. */
export function useApprovePendingFabricControllerRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    ...postFabricControllerInvitationsRequestsByRequestIdApproveMutation(),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: getFabricControllerInvitationsRequestsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
    ]),
  })
}

/** Owner-side: reject one pending Controller enrollment request. */
export function useRejectPendingFabricControllerRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteFabricControllerInvitationsRequestsByRequestIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getFabricControllerInvitationsRequestsQueryKey() }),
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

/** Permanently revoke a Controller principal and every grant it holds. */
export function useRevokeFabricController(nodeIds: string[]) {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteFabricControllersByControllerIdMutation(),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
        ...nodeIds.map(nodeId => queryClient.invalidateQueries({
          queryKey: getNodesByNodeIdGrantsQueryKey({ path: { nodeId } }),
        })),
      ]),
  })
}

/** Permanently remove a remote Node and its Controller identity (owner-only). */
export function useRemoveNode() {
  const queryClient = useQueryClient()
  return useMutation({
    ...deleteNodesByNodeIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
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

/**
 * Fetch a Node's workspace summaries on demand over its link. Consumers must
 * distinguish query failure from a successful empty inventory.
 */
export function useNodeWorkspaces(node: FabricNode | null, enabled: boolean) {
  const nodeId = node?.nodeId ?? ''
  return useQuery({
    ...nodeUpstreamQueryOptions<GetWorkspacesResponse>(nodeId, '/workspaces', ['workspaces']),
    enabled: enabled && node !== null && node.status === 'online',
    select: workspaces => workspaces.map(toNodeWorkspaceSummary),
    staleTime: 30_000,
  })
}

export interface NodeWorkspaceInventory {
  node: { nodeId: string, nodeName: string }
  workspaces: NodeWorkspaceSummary[]
}

/**
 * Fetch workspace inventories of several Nodes at once (used by repo-cluster
 * shadow discovery). Only successful inventories are returned; offline or
 * unreachable Nodes are silently skipped.
 */
export function useNodeWorkspaceInventories(nodes: readonly FabricNode[], enabled: boolean): NodeWorkspaceInventory[] {
  const queries = useQueries({
    queries: nodes.map(node => ({
      ...nodeUpstreamQueryOptions<GetWorkspacesResponse>(node.nodeId, '/workspaces', ['workspaces']),
      enabled: enabled && node.status === 'online',
      select: (workspaces: GetWorkspacesResponse) => workspaces.map(toNodeWorkspaceSummary),
      staleTime: 30_000,
    })),
  })
  return useMemo(
    () =>
      queries.flatMap((query, index) => {
        const node = nodes[index]
        if (!node || !query.data) {
          return []
        }
        return [{ node: { nodeId: node.nodeId, nodeName: node.displayName }, workspaces: query.data }]
      }),
    [nodes, queries],
  )
}

export type { FabricNodeInvitation }
