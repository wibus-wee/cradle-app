import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  deleteNodesByNodeIdGrantsByGrantIdMutation,
  getFabricManagedRelayOptions,
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
import type { GetWorkspacesResponse } from '~/api-gen/types.gen'

import type { NodeWorkspaceSummary } from './node-grouping'
import { resolveNodeDisplayName } from './node-grouping'
import type { FabricNode, FabricNodeInvitation } from './types'
import { nodeUpstreamQueryOptions } from './upstream-fetch'

/** This device's Fabric membership, or `null` when unenrolled. */
export function useFabricMembership() {
  return useQuery({ ...getFabricOptions(), staleTime: 30_000 })
}

/** Desktop's local relay endpoint used when creating the first Fabric. */
export function useManagedRelay() {
  return useQuery({ ...getFabricManagedRelayOptions(), staleTime: 30_000 })
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

function useInvalidateFabric() {
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: getFabricQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getNodesQueryKey() }),
      ]),
    [queryClient],
  )
}

/** Create a Cradle Fabric and enroll this device as its first Node. */
export function useCreateFabric() {
  const invalidate = useInvalidateFabric()
  return useMutation({
    ...postFabricMutation(),
    onSuccess: invalidate,
  })
}

/**
 * Begin enrolling this device into an existing Fabric. The returned invitation
 * string is a one-time secret: it is shown once and never list-readable.
 */
export function useCreateNodeInvitation() {
  return useMutation({ ...postFabricNodeInvitationsMutation() })
}

/** Poll completion of an owner-approved enrollment on this device. */
export function useCompleteNodeEnrollment() {
  const invalidate = useInvalidateFabric()
  return useMutation({
    ...postFabricNodeInvitationsCompleteMutation(),
    onSuccess: invalidate,
  })
}

/** Owner-side: approve a pasted Node invitation string. */
export function useApproveNodeInvitation() {
  const invalidate = useInvalidateFabric()
  return useMutation({
    ...postFabricNodeInvitationsApproveMutation(),
    onSuccess: invalidate,
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
