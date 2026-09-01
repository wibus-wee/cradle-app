import type { FabricEnrollmentStatus, FabricMembershipStatus } from '@/features/fabric/fabric-context'
import type {
  MobileFabricMembership,
  PendingFabricControllerEnrollment,
} from '@/features/fabric/fabric-types'

export interface OnboardingViewProps {
  membership: MobileFabricMembership | null
  pendingEnrollment: PendingFabricControllerEnrollment | null
  enrollmentStatus: FabricEnrollmentStatus
  membershipStatus: FabricMembershipStatus
  error?: string | null
  onJoinFabric: (code: string) => void
  onCancelEnrollment: () => void
  onRefreshDirectory: () => void
  onSelectNode: (nodeId: string) => void
  onUseDirectServer: () => void
  onLeaveFabric: () => void
}
