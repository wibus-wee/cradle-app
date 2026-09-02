import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toastManager } from '~/components/ui/toast'

import { decodeInviteCode, encodeControllerPairingCode, encodeInviteCode } from './invite-code'
import type {
  ControllerGrantSelection,
  FabricControllerAccess,
  FabricNodeInvitation,
  NodeGrant,
  PendingFabricControllerRequest,
  PendingFabricNodeRequest,
} from './types'
import {
  useApproveNodeInvitation,
  useApprovePendingFabricControllerRequest,
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
  useNodeGrantsForNodes,
  useNodes,
  usePendingFabricControllerRequests,
  usePendingFabricEnrollment,
  usePendingFabricNodeRequests,
  useRejectPendingFabricControllerRequest,
  useRejectPendingFabricNodeRequest,
  useRemoveNode,
  useRevokeFabricController,
  useRevokeNodeGrant,
} from './use-nodes'

interface ApiErrorPayload {
  message?: unknown
  body?: ApiErrorPayload
  error?: ApiErrorPayload | string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    const payload = error as ApiErrorPayload
    if (typeof payload.message === 'string' && payload.message.length > 0) {
      return payload.message
    }
    if (payload.body) {
      const bodyMessage = errorMessage(payload.body)
      if (bodyMessage !== '[object Object]') {
        return bodyMessage
      }
    }
      if (typeof payload.error === 'string' && payload.error.length > 0) {
        return payload.error
      }
    if (payload.error) {
      const nestedMessage = errorMessage(payload.error)
      if (nestedMessage !== '[object Object]') {
        return nestedMessage
      }
    }
  }

  if (typeof error === 'object' && error !== null) {
    try {
      const serialized = JSON.stringify(error)
      if (serialized) {
        return serialized
      }
    }
    catch {
      // Fall through for cyclic values that cannot be serialized.
    }
  }
  return String(error)
}

const APPROVAL_POLL_MS = 3000

export function useNodesController() {
  const { t } = useTranslation('nodes')
  const membershipQuery = useFabricMembership()
  const managedRelayQuery = useManagedRelay()
  const pendingEnrollmentQuery = usePendingFabricEnrollment()
  const membership = membershipQuery.data ?? null
  const nodesQuery = useNodes(membership !== null)
  const managedRelay = managedRelayQuery.data ?? null
  const pendingEnrollment = pendingEnrollmentQuery.data ?? null
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data])
  const controllerGrantsQuery = useNodeGrantsForNodes(
    nodes.map(node => node.nodeId),
    membership?.role === 'owner',
  )
  const pendingRequestsQuery = usePendingFabricNodeRequests(membership?.role === 'owner')
  const pendingRequests = useMemo<PendingFabricNodeRequest[]>(
    () => pendingRequestsQuery.data ?? [],
    [pendingRequestsQuery.data],
  )
  const pendingControllerRequestsQuery = usePendingFabricControllerRequests(membership?.role === 'owner')
  const pendingControllerRequests = useMemo<PendingFabricControllerRequest[]>(
    () => pendingControllerRequestsQuery.data ?? [],
    [pendingControllerRequestsQuery.data],
  )

  const [connectOpen, setConnectOpen] = useState(false)
  const [accessNodeId, setAccessNodeId] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<FabricNodeInvitation | null>(null)
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null)
  const [revokingControllerId, setRevokingControllerId] = useState<string | null>(null)
  const [pendingRequestAction, setPendingRequestAction] = useState<{ requestId: string, kind: 'approve' | 'reject' } | null>(null)
  const [controllerApprovalRequestId, setControllerApprovalRequestId] = useState<string | null>(null)
  const [pendingControllerAction, setPendingControllerAction] = useState<{ requestId: string, kind: 'approve' | 'reject' } | null>(null)

  const createFabric = useCreateFabric()
  const createInvitation = useCreateNodeInvitation()
  const cancelEnrollment = useCancelPendingFabricEnrollment()
  const leaveFabric = useLeaveFabric()
  const completeEnrollment = useCompleteNodeEnrollment()
  const approveInvitation = useApproveNodeInvitation()
  const approvePendingRequest = useApprovePendingFabricNodeRequest()
  const rejectPendingRequest = useRejectPendingFabricNodeRequest()
  const approvePendingController = useApprovePendingFabricControllerRequest()
  const rejectPendingController = useRejectPendingFabricControllerRequest()
  const connectNode = useConnectNode()
  const revokeGrant = useRevokeNodeGrant()
  const revokeController = useRevokeFabricController(nodes.map(node => node.nodeId))
  const removeNode = useRemoveNode()

  const accessNode = accessNodeId
    ? (nodes.find(node => node.nodeId === accessNodeId) ?? null)
    : null
  const controllerApprovalRequest = controllerApprovalRequestId
    ? (pendingControllerRequests.find(request => request.requestId === controllerApprovalRequestId) ?? null)
    : null
  const grantsQuery = useNodeGrants(accessNodeId)
  const accessGrants = useMemo<NodeGrant[]>(
    () =>
      (grantsQuery.data ?? []).map(grant => ({
        grantId: grant.grantId,
        controllerId: grant.controllerId,
        controllerLabel:
          grant.controllerDisplayName
          ?? nodes.find(node => node.nodeId === grant.controllerId)?.displayName
          ?? grant.controllerId,
        nodeId: grant.nodeId,
        scope: grant.scope,
        revokedAt: grant.revokedAt ?? null,
      })),
    [grantsQuery.data, nodes],
  )
  const controllers = useMemo(() => {
    const nodeIds = new Set(nodes.map(node => node.nodeId))
    const grouped = new Map<string, FabricControllerAccess>()
    for (const sourceGrant of controllerGrantsQuery.data) {
      if (sourceGrant.revokedAt) {
        continue
      }
      const grant: NodeGrant = {
        grantId: sourceGrant.grantId,
        controllerId: sourceGrant.controllerId,
        controllerLabel: sourceGrant.controllerDisplayName ?? sourceGrant.controllerId,
        nodeId: sourceGrant.nodeId,
        scope: sourceGrant.scope,
        revokedAt: sourceGrant.revokedAt ?? null,
      }
      // A computer's companion Controller is represented by the Node itself;
      // only show separately enrolled Controllers in this summary.
      if (nodeIds.has(grant.controllerId)) {
        continue
      }
      const existing = grouped.get(grant.controllerId)
      if (existing) {
        existing.grants.push(grant)
      }
      else {
        grouped.set(grant.controllerId, {
          controllerId: grant.controllerId,
          displayName: sourceGrant.controllerDisplayName ?? sourceGrant.controllerId,
          grants: [grant],
        })
      }
    }
    return [...grouped.values()]
  }, [controllerGrantsQuery.data, nodes])

  const networkCode = useMemo(
    () =>
      membership
        ? encodeControllerPairingCode({
            relayUrl: membership.relayUrl,
            fabricId: membership.fabricId,
            ownerPubkey: membership.ownerPubkey,
          })
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

  const handleApprovePendingController = useCallback(async (grants: ControllerGrantSelection[]) => {
    if (!controllerApprovalRequestId) {
      return
    }
    const requestId = controllerApprovalRequestId
    setPendingControllerAction({ requestId, kind: 'approve' })
    try {
      await approvePendingController.mutateAsync({
        path: { requestId },
        body: { grants },
      })
      toastManager.add({
        type: 'success',
        title: t('toast.controllerApproved', { name: controllerApprovalRequest?.displayName ?? '' }),
      })
      setControllerApprovalRequestId(null)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('toast.approveControllerFailed'),
        description: errorMessage(error),
      })
    }
    finally {
      setPendingControllerAction(null)
    }
  }, [approvePendingController, controllerApprovalRequest?.displayName, controllerApprovalRequestId, t])

  const handleRejectPendingController = useCallback(async (requestId: string) => {
    setPendingControllerAction({ requestId, kind: 'reject' })
    try {
      await rejectPendingController.mutateAsync({ path: { requestId } })
      if (controllerApprovalRequestId === requestId) {
        setControllerApprovalRequestId(null)
      }
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('toast.rejectControllerFailed'),
        description: errorMessage(error),
      })
    }
    finally {
      setPendingControllerAction(null)
    }
  }, [controllerApprovalRequestId, rejectPendingController, t])

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

  const handleRevokeController = useCallback(
    async (controllerId: string) => {
      setRevokingControllerId(controllerId)
      try {
        await revokeController.mutateAsync({ path: { controllerId } })
        toastManager.add({ type: 'success', title: t('toast.controllerRevoked') })
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.revokeControllerFailed'),
          description: errorMessage(error),
        })
      }
      finally {
        setRevokingControllerId(null)
      }
    },
    [revokeController, t],
  )

  const handleRemoveNode = useCallback(
    async (nodeId: string) => {
      try {
        await removeNode.mutateAsync({ path: { nodeId } })
        if (accessNodeId === nodeId) {
          setAccessNodeId(null)
        }
        toastManager.add({ type: 'success', title: t('toast.deviceRemoved') })
      }
      catch (error) {
        toastManager.add({
          type: 'error',
          title: t('toast.deviceRemoveFailed'),
          description: errorMessage(error),
        })
      }
    },
    [accessNodeId, removeNode, t],
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
    controllers,
    controllersLoading: controllerGrantsQuery.isLoading,
    controllersError: controllerGrantsQuery.isError,
    refreshNodes: () => void nodesQuery.refetch(),
    pendingRequests,
    pendingRequestsLoading: pendingRequestsQuery.isLoading,
    pendingRequestsError: pendingRequestsQuery.isError,
    pendingControllerRequests,
    pendingControllerRequestsLoading: pendingControllerRequestsQuery.isLoading,
    pendingControllerRequestsError: pendingControllerRequestsQuery.isError,
    refreshPendingRequests: () => void Promise.all([
      pendingRequestsQuery.refetch(),
      pendingControllerRequestsQuery.refetch(),
    ]),
    pendingRequestAction,
    pendingControllerAction,
    controllerApprovalRequest,
    controllerApprovalRequestId,
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
    revokingControllerId,
    removingNodeId: removeNode.isPending ? (removeNode.variables?.path.nodeId ?? null) : null,
    connectingNodeId: connectNode.isPending ? (connectNode.variables?.path.nodeId ?? null) : null,
    busy: managedRelayQuery.isLoading || createFabric.isPending || createInvitation.isPending || approveInvitation.isPending,
    setConnectOpen,
    setAccessNodeId,
    setControllerApprovalRequestId,
    handleReconnect,
    handleStart,
    handleGetCode,
    handleSubmitCode,
    handleCancelEnrollment,
    handleLeaveFabric,
    handleApprovePendingRequest,
    handleRejectPendingRequest,
    handleApprovePendingController,
    handleRejectPendingController,
    handleRevokeGrant,
    handleRevokeController,
    handleRemoveNode,
    handleConnectOpenChange,
  }
}
