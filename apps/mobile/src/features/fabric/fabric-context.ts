import { createContext, useContext } from 'react'

import type { FabricTransportStatus } from '@/lib/transport/fabric-http-transport'
import type { CradleTransport } from '@/lib/transport/types'

import type {
  MobileFabricMembership,
  PendingFabricControllerEnrollment,
} from './fabric-types'

export type FabricEnrollmentStatus = 'idle' | 'submitting' | 'pending' | 'rejected' | 'expired'
export type FabricMembershipStatus = 'none' | 'active' | 'offline' | 'revoked' | 'invalid'

export interface FabricContextValue {
  membership: MobileFabricMembership | null
  pendingEnrollment: PendingFabricControllerEnrollment | null
  enrollmentStatus: FabricEnrollmentStatus
  membershipStatus: FabricMembershipStatus
  error: string | null
  isRestoring: boolean
  transport: CradleTransport | null
  transportStatus: FabricTransportStatus
  beginEnrollment: (pairingCode: string) => Promise<void>
  cancelEnrollment: () => Promise<void>
  refreshDirectory: () => Promise<void>
  selectNode: (nodeId: string) => Promise<void>
  leaveFabric: () => Promise<void>
}

export const FabricContext = createContext<FabricContextValue | null>(null)

export function useFabric(): FabricContextValue {
  const context = useContext(FabricContext)
  if (!context) {
    throw new Error('useFabric must be used within FabricProvider')
  }
  return context
}
