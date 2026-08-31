import type { OnboardingViewProps } from './onboarding-view-contract'

export const onboardingFixture: OnboardingViewProps = {
  membership: null,
  pendingEnrollment: null,
  enrollmentStatus: 'idle',
  membershipStatus: 'none',
  onJoinFabric: () => {},
  onCancelEnrollment: () => {},
  onRefreshDirectory: () => {},
  onSelectNode: () => {},
  onUseDirectServer: () => {},
  onLeaveFabric: () => {},
}

export const onboardingErrorFixture: OnboardingViewProps = {
  ...onboardingFixture,
  error: 'The Fabric Relay could not be reached from this device.',
}
