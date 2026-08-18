import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toastManager } from '~/components/ui/toast'

import { decodeInviteCode, encodeInviteCode } from './invite-code'
import type { FabricNodeInvitation, NodeGrant, PendingFabricNodeRequest } from './types'
import {
  useApproveNodeInvitation,
  useApprovePendingFabricNodeRequest,
  useCancelPendingFabricEnrollment,
  useCompleteNodeEnrollment,
  useConnectNode,
  useCreateFabric,
  useCreateNodeInvitation,
  useFabricMembership,
  useLeaveFabric,
  useManagedRelay,
  useNodeGrants,
  useNodes,
  usePendingFabricEnrollment,
  usePendingFabricNodeRequests,
  useRejectPendingFabricNodeRequest,
  useRevokeNodeGrant,
} from './use-nodes'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const APPROVAL_POLL_MS = 3000

export function useNodesController() {
  const { t } = useTranslation('nodes')
  const membershipQuery = useFabricMembership()
  const managedRelayQuery = useManagedRelay()
  const pendingEnrollmentQuery = usePendingFabricEnrollment()
  const nodesQuery = useNodes()
  const membership = membershipQuery.data ?? null
  const managedRelay = managedRelayQuery.data ?? null
  const pendingEnrollment = pendingEnrollmentQuery.data ?? null
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data])
  const pendingRequestsQuery = usePendingFabricNodeRequests(membership?.role === 'owner')
  const pendingRequests = useMemo<PendingFabricNodeRequest[]>(
    () => pendingRequestsQuery.data ?? [],
    [pendingRequestsQuery.data],
  )

  const [connectOpen, setConnectOpen] = useState(false)
  const [accessNodeId, setAccessNodeId] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<FabricNodeInvitation | null>(null)
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null)
  const [pendingRequestAction, setPendingRequestAction] = useState<{ requestId: string, kind: 'approve' | 'reject' } | null>(null)

  const createFabric = useCreateFabric()
  const createInvitation = useCreateNodeInvitation()
  const cancelEnrollment = useCancelPendingFabricEnrollment()
  const leaveFabric = useLeaveFabric()
  const completeEnrollment = useCompleteNodeEnrollment()
  const approveInvitation = useApproveNodeInvitation()
  const approvePendingRequest = useApprovePendingFabricNodeRequest()
  const rejectPendingRequest = useRejectPendingFabricNodeRequest()
  const connectNode = useConnectNode()
  const revokeGrant = useRevokeNodeGrant()

  const accessNode = accessNodeId
    ? (nodes.find(node => node.nodeId === accessNodeId) ?? null)
    : null
  const grantsQuery = useNodeGrants(accessNodeId)
  const accessGrants = useMemo<NodeGrant[]>(
    () =>
      (grantsQuery.data ?? []).map(grant => ({
        grantId: grant.grantId,
        controllerLabel:
          nodes.find(node => node.nodeId === grant.controllerId)?.displayName ?? grant.controllerId,
        scope: grant.scope,
        revokedAt: grant.revokedAt ?? null,
      })),
    [grantsQuery.data, nodes],
  )

  const networkCode = useMemo(
    () =>
      membership
        ? encodeInviteCode({ relayUrl: membership.relayUrl, fabricId: membership.fabricId })
        : null,
    [membership],
  )
  const inviteCode = useMemo(
    () => {
      if (invitation) {
        return encodeInviteCode(invitation)
      }
      if (!pendingEnrollment?.expiresAt) {
        return null
      }
      return encodeInviteCode({
        version: 1,
        relayUrl: pendingEnrollment.relayUrl,
        fabricId: pendingEnrollment.fabricId,
        requestId: pendingEnrollment.requestId,
        deliverySecret: pendingEnrollment.deliverySecret,
        expiresAt: pendingEnrollment.expiresAt,
      })
    },
    [invitation, pendingEnrollment],
  )
  const awaitingApproval = invitation !== null || pendingEnrollment !== null

  useEffect(() => {
    if (!awaitingApproval) {
      return
    }
    const timer = setInterval(() => {
      completeEnrollment.mutate(
        {},
        {
          onSuccess: (completed) => {
            if (completed) {
              setInvitation(null)
              setConnectOpen(false)
            }
          },
          onError: () => {
            // Transient poll failure; the next tick retries.
          },
        },
      )
    }, APPROVAL_POLL_MS)
    return () => clearInterval(timer)
    // The polling lifecycle follows the visible invitation, not mutation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingApproval])

  const handleReconnect = useCallback(
    async (nodeId: string) => {
      try {
        await connectNode.mutateAsync({ path: { nodeId } })
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.connectFailed'),
          description: errorMessage(error),
        })
      }
    },
    [connectNode, t],
  )

  const handleStart = useCallback(
    async () => {
      if (!managedRelay) {
        toastManager.add({ type: 'error', title: t('toast.relayUnavailable') })
        return
      }
      try {
        await createFabric.mutateAsync({
          body: {
            relayUrl: managedRelay.relayUrl,
          },
        })
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.linkFailed'),
          description: errorMessage(error),
        })
      }
    },
    [createFabric, managedRelay, t],
  )

  const handleGetCode = useCallback(
    async (rawNetworkCode: string, displayName: string) => {
      const network = decodeInviteCode<{ relayUrl?: unknown, fabricId?: unknown }>(rawNetworkCode)
      if (
        !network
        || typeof network.relayUrl !== 'string'
        || typeof network.fabricId !== 'string'
      ) {
        toastManager.add({ type: 'error', title: t('toast.codeInvalid') })
        return
      }
      try {
        const created = await createInvitation.mutateAsync({
          body: {
            relayUrl: network.relayUrl,
            fabricId: network.fabricId,
            ...(displayName ? { displayName } : {}),
          },
        })
        setInvitation(created)
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.linkFailed'),
          description: errorMessage(error),
        })
      }
    },
    [createInvitation, t],
  )

  const handleSubmitCode = useCallback(
    async (rawCode: string) => {
      const parsed = decodeInviteCode<FabricNodeInvitation>(rawCode)
      if (!parsed) {
        toastManager.add({ type: 'error', title: t('toast.codeInvalid') })
        return
      }
      try {
        const approved = await approveInvitation.mutateAsync({ body: parsed })
        toastManager.add({
          type: 'success',
          title: t('toast.linked', { name: approved.displayName }),
        })
        setConnectOpen(false)
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.linkFailed'),
          description: errorMessage(error),
        })
      }
    },
    [approveInvitation, t],
  )

  const handleCancelEnrollment = useCallback(async () => {
    try {
      await cancelEnrollment.mutateAsync({})
      setInvitation(null)
      setConnectOpen(false)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('toast.cancelFailed'),
        description: errorMessage(error),
      })
    }
  }, [cancelEnrollment, t])

  const handleLeaveFabric = useCallback(async () => {
    try {
      await leaveFabric.mutateAsync({})
    }
    catch (error) {
      toastManager.add({ type: 'error', title: t('toast.leaveFailed'), description: errorMessage(error) })
    }
  }, [leaveFabric, t])

  const handleApprovePendingRequest = useCallback(async (requestId: string) => {
    setPendingRequestAction({ requestId, kind: 'approve' })
    try {
      const approved = await approvePendingRequest.mutateAsync({ path: { requestId } })
      toastManager.add({ type: 'success', title: t('toast.linked', { name: approved.displayName }) })
    }
    catch (error) {
      toastManager.add({ type: 'error', title: t('toast.approveFailed'), description: errorMessage(error) })
    }
    finally {
      setPendingRequestAction(null)
    }
  }, [approvePendingRequest, t])

  const handleRejectPendingRequest = useCallback(async (requestId: string) => {
    setPendingRequestAction({ requestId, kind: 'reject' })
    try {
      await rejectPendingRequest.mutateAsync({ path: { requestId } })
    }
    catch (error) {
      toastManager.add({ type: 'error', title: t('toast.rejectFailed'), description: errorMessage(error) })
    }
    finally {
      setPendingRequestAction(null)
    }
  }, [rejectPendingRequest, t])

  const handleRevokeGrant = useCallback(
    async (grantId: string) => {
      if (!accessNodeId) {
        return
      }
      setRevokingGrantId(grantId)
      try {
        await revokeGrant.mutateAsync({ path: { nodeId: accessNodeId, grantId } })
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.removeFailed'),
          description: errorMessage(error),
        })
      }
      finally {
        setRevokingGrantId(null)
      }
    },
    [accessNodeId, revokeGrant, t],
  )

  const handleConnectOpenChange = useCallback((open: boolean) => {
    setConnectOpen(open)
    if (!open) {
      setInvitation(null)
    }
  }, [])

  return {
    membership,
    pendingEnrollment,
    membershipLoading: membershipQuery.isLoading || pendingEnrollmentQuery.isLoading,
    membershipError: membershipQuery.isError || pendingEnrollmentQuery.isError,
    refreshMembership: () => void Promise.all([membershipQuery.refetch(), pendingEnrollmentQuery.refetch()]),
    managedRelay,
    nodes,
    nodesLoading: nodesQuery.isLoading,
    nodesError: nodesQuery.isError,
    refreshNodes: () => void nodesQuery.refetch(),
    pendingRequests,
    pendingRequestsLoading: pendingRequestsQuery.isLoading,
    pendingRequestsError: pendingRequestsQuery.isError,
    refreshPendingRequests: () => void pendingRequestsQuery.refetch(),
    pendingRequestAction,
    networkCode,
    inviteCode,
    awaitingApproval,
    cancellingEnrollment: cancelEnrollment.isPending,
    leavingFabric: leaveFabric.isPending,
    connectOpen,
    accessNode,
    accessNodeId,
    accessGrants,
    revokingGrantId,
    connectingNodeId: connectNode.isPending ? (connectNode.variables?.path.nodeId ?? null) : null,
    busy: managedRelayQuery.isLoading || createFabric.isPending || createInvitation.isPending || approveInvitation.isPending,
    setConnectOpen,
    setAccessNodeId,
    handleReconnect,
    handleStart,
    handleGetCode,
    handleSubmitCode,
    handleCancelEnrollment,
    handleLeaveFabric,
    handleApprovePendingRequest,
    handleRejectPendingRequest,
    handleRevokeGrant,
    handleConnectOpenChange,
  }
}
