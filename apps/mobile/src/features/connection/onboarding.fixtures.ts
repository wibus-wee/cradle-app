import type { OnboardingViewProps } from './onboarding-view-contract'

export const onboardingFixture: OnboardingViewProps = {
  defaultUrl: 'http://192.168.1.20:21423',
  onConnect: () => {},
}

export const onboardingErrorFixture: OnboardingViewProps = {
  ...onboardingFixture,
  error: 'The server could not be reached from this device.',
}
