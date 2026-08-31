import { useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import type { PropsWithChildren } from 'react'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Platform } from 'react-native'

import { AppActiveContext } from '@/lib/app-lifecycle-context'
import type { FabricTransportStatus } from '@/lib/transport/fabric-http-transport'
import { FabricHttpTransport } from '@/lib/transport/fabric-http-transport'

import {
  createFabricEnrollmentDraft,
  ensureFabricEnrollmentRequest,
  FabricRelayError,
  pollFabricEnrollment,
  refreshFabricDirectory,
  selectFabricNode,
  validateStoredFabricMembership,
} from './fabric-client'
import type {
  FabricEnrollmentStatus,
  FabricMembershipStatus,
} from './fabric-context'
import { FabricContext } from './fabric-context'
import { parseFabricPairingCode } from './fabric-pairing-code'
import {
  clearStoredFabricState,
  loadFabricState,
  persistFabricMembership,
  persistPendingFabricEnrollment,
  updateStoredFabricMembership,
} from './fabric-storage'
import type {
  FabricSecretState,
  MobileFabricMembership,
  PendingFabricControllerEnrollment,
} from './fabric-types'

const APPROVAL_POLL_MS = 3000

function messageFromError(error: Error): string {
  if (error instanceof TypeError) {
    return 'The Fabric Relay could not be reached from this device.'
  }
  return error.message
}

function membershipFailureStatus(error: Error): FabricMembershipStatus {
  if (error instanceof FabricRelayError && [401, 403].includes(error.status)) {
    return 'revoked'
  }
  if (error instanceof TypeError || error instanceof FabricRelayError) {
    return 'offline'
  }
  return 'invalid'
}

export function FabricProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const isAppActive = useContext(AppActiveContext)
  const [membership, setMembership] = useState<MobileFabricMembership | null>(null)
  const [pendingEnrollment, setPendingEnrollment] = useState<PendingFabricControllerEnrollment | null>(null)
  const [secrets, setSecrets] = useState<FabricSecretState | null>(null)
  const [enrollmentStatus, setEnrollmentStatus] = useState<FabricEnrollmentStatus>('idle')
  const [membershipStatus, setMembershipStatus] = useState<FabricMembershipStatus>('none')
  const [error, setError] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [transportStatus, setTransportStatus] = useState<FabricTransportStatus>('idle')
  const pollingRef = useRef(false)
  const membershipControllerId = membership?.controllerId ?? null
  const membershipFabricId = membership?.fabricId ?? null
  const membershipRelayUrl = membership?.relayUrl ?? null
  const membershipOwnerPubkey = membership?.ownerPubkey ?? null
  const controllerCertificate = membership?.controllerCertificate ?? null
  const selectedNodeId = membership?.selectedNodeId ?? null
  const identityPrivateKey = secrets?.identityPrivateKeyBase64 ?? null
  const encryptionPrivateKey = secrets?.encryptionPrivateKeyBase64 ?? null

  const transport = useMemo(() => {
    if (
      !membershipFabricId
      || !membershipRelayUrl
      || !membershipOwnerPubkey
      || !controllerCertificate
      || !identityPrivateKey
      || !encryptionPrivateKey
      || !selectedNodeId
    ) {
      return null
    }
    return new FabricHttpTransport({
      fabricId: membershipFabricId,
      relayUrl: membershipRelayUrl,
      ownerPubkey: membershipOwnerPubkey,
      controllerCertificate,
    }, {
      identityPrivateKeyBase64: identityPrivateKey,
      encryptionPrivateKeyBase64: encryptionPrivateKey,
    }, selectedNodeId, {
      onStatusChange: setTransportStatus,
    })
  }, [
    controllerCertificate,
    encryptionPrivateKey,
    identityPrivateKey,
    membershipFabricId,
    membershipOwnerPubkey,
    membershipRelayUrl,
    selectedNodeId,
  ])

  useEffect(() => {
    if (!transport) {
      setTransportStatus('idle')
      return
    }
    transport.setActive(
      isAppActive && membershipStatus !== 'revoked' && membershipStatus !== 'invalid',
    )
    return () => transport.close('Fabric connection changed.')
  }, [isAppActive, membershipStatus, transport])

  useEffect(() => {
    let cancelled = false
    void loadFabricState()
      .then((stored) => {
        if (cancelled) {
          return
        }
        if (stored.metadata.membership && stored.secrets) {
          validateStoredFabricMembership(stored.metadata.membership, stored.secrets)
          setMembership(stored.metadata.membership)
          setMembershipStatus('active')
        }
        if (stored.metadata.pending) {
          setPendingEnrollment(stored.metadata.pending)
          setEnrollmentStatus(
            Date.parse(stored.metadata.pending.expiresAt) <= Date.now() ? 'expired' : 'pending',
          )
        }
        setSecrets(stored.secrets)
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setMembershipStatus('invalid')
          setError(messageFromError(cause))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoring(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshDirectory = useCallback(async () => {
    if (!membership || !secrets) {
      return
    }
    try {
      const refreshed = await refreshFabricDirectory(membership, secrets)
      await updateStoredFabricMembership(refreshed)
      setMembership(refreshed)
      setMembershipStatus('active')
      setError(null)
    }
    catch (cause) {
      const failure = cause as Error
      setMembershipStatus(membershipFailureStatus(failure))
      setError(messageFromError(failure))
      throw failure
    }
  }, [membership, secrets])

  const refreshDirectoryRef = useRef(refreshDirectory)
  useEffect(() => {
    refreshDirectoryRef.current = refreshDirectory
  }, [refreshDirectory])

  useEffect(() => {
    if (transportStatus === 'access-denied' && isAppActive) {
      void refreshDirectoryRef.current()
        .then(() => setTransportStatus('idle'))
        .catch(() => {})
    }
  }, [isAppActive, transportStatus])

  useEffect(() => {
    if (isRestoring || !isAppActive || !membershipControllerId || !secrets) {
      return
    }
    void refreshDirectoryRef.current().catch(() => {})
  }, [isAppActive, isRestoring, membershipControllerId, secrets])

  useEffect(() => {
    if (
      isRestoring
      || !isAppActive
      || !pendingEnrollment
      || !secrets
      || enrollmentStatus === 'rejected'
      || enrollmentStatus === 'expired'
    ) {
      return
    }

    const poll = async () => {
      if (pollingRef.current) {
        return
      }
      if (Date.parse(pendingEnrollment.expiresAt) <= Date.now()) {
        setEnrollmentStatus('expired')
        return
      }
      pollingRef.current = true
      try {
        const result = await pollFabricEnrollment(pendingEnrollment, secrets)
        if (result.status === 'approved') {
          await persistFabricMembership(result.membership, secrets)
          queryClient.clear()
          setMembership(result.membership)
          setPendingEnrollment(null)
          setSecrets({ ...secrets, pendingDeliverySecret: null })
          setEnrollmentStatus('idle')
          setMembershipStatus('active')
          setError(null)
        }
        else if (result.status === 'rejected') {
          setEnrollmentStatus('rejected')
          setError('The Fabric owner rejected this Controller request.')
        }
        else {
          setEnrollmentStatus('pending')
          setError(null)
        }
      }
      catch (cause) {
        setEnrollmentStatus('pending')
        setError(messageFromError(cause as Error))
      }
      finally {
        pollingRef.current = false
      }
    }

    void ensureFabricEnrollmentRequest(pendingEnrollment)
      .then(poll)
      .catch((cause: Error) => setError(messageFromError(cause)))
    const timer = setInterval(() => void poll(), APPROVAL_POLL_MS)
    return () => clearInterval(timer)
  }, [enrollmentStatus, isAppActive, isRestoring, pendingEnrollment, queryClient, secrets])

  const beginEnrollment = useCallback(async (pairingCode: string) => {
    const pairing = parseFabricPairingCode(pairingCode)
    const draft = createFabricEnrollmentDraft(pairing, {
      displayName: Constants.deviceName ?? `Cradle Mobile (${Platform.OS})`,
      platform: Platform.OS,
      version: Constants.expoConfig?.version ?? '0.1.0',
      capabilities: ['chat', 'work', 'workspace'],
    })
    setEnrollmentStatus('submitting')
    setError(null)
    let persisted = false
    try {
      await persistPendingFabricEnrollment(draft.pending, draft.secrets)
      persisted = true
      setPendingEnrollment(draft.pending)
      setSecrets(draft.secrets)
      await ensureFabricEnrollmentRequest(draft.pending)
      setEnrollmentStatus('pending')
    }
    catch (cause) {
      if (!persisted) {
        await clearStoredFabricState().catch(() => {})
      }
      setEnrollmentStatus(persisted ? 'pending' : 'idle')
      setError(messageFromError(cause as Error))
      throw cause
    }
  }, [])

  const cancelEnrollment = useCallback(async () => {
    await clearStoredFabricState()
    setPendingEnrollment(null)
    setSecrets(null)
    setEnrollmentStatus('idle')
    setError(null)
  }, [])

  const selectNode = useCallback(async (nodeId: string) => {
    if (!membership) {
      throw new Error('Join a Fabric before selecting a computer.')
    }
    const selected = selectFabricNode(membership, nodeId)
    await updateStoredFabricMembership(selected)
    queryClient.clear()
    setMembership(selected)
  }, [membership, queryClient])

  const leaveFabric = useCallback(async () => {
    await clearStoredFabricState()
    queryClient.clear()
    setMembership(null)
    setPendingEnrollment(null)
    setSecrets(null)
    setEnrollmentStatus('idle')
    setMembershipStatus('none')
    setTransportStatus('idle')
    setError(null)
  }, [queryClient])

  const value = useMemo(() => ({
    membership,
    pendingEnrollment,
    enrollmentStatus,
    membershipStatus,
    error,
    isRestoring,
    transport,
    transportStatus,
    beginEnrollment,
    cancelEnrollment,
    refreshDirectory,
    selectNode,
    leaveFabric,
  }), [
    beginEnrollment,
    cancelEnrollment,
    enrollmentStatus,
    error,
    isRestoring,
    leaveFabric,
    membership,
    membershipStatus,
    pendingEnrollment,
    refreshDirectory,
    selectNode,
    transport,
    transportStatus,
  ])

  return <FabricContext value={value}>{children}</FabricContext>
}
