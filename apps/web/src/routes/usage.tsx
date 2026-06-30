import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const UsageDashboard = lazy(() => import('~/features/usage/usage-dashboard').then(module => ({ default: module.UsageDashboard })))

export const Route = createFileRoute('/usage')({
  component: UsageRoute,
})

function UsageRoute() {
  return (
    <Suspense fallback={null}>
      <UsageDashboard />
    </Suspense>
  )
}
