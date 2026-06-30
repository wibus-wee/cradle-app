import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const OnboardingPage = lazy(() =>
  import('~/features/onboarding/onboarding-page').then(m => ({
    default: m.OnboardingPage,
  })))

export const Route = createFileRoute('/onboarding')({
  component: OnboardingRoute,
})

function OnboardingRoute() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-background" />}>
      <OnboardingPage />
    </Suspense>
  )
}
