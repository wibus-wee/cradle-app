import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const AutomationDashboard = lazy(() => import('~/features/automation').then(module => ({ default: module.AutomationDashboard })))

export const Route = createFileRoute('/automation')({
  component: AutomationRoute,
})

function AutomationRoute() {
  return (
    <Suspense fallback={null}>
      <AutomationDashboard />
    </Suspense>
  )
}
