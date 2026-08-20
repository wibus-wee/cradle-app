import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const AwaitsOverview = lazy(() => import('~/features/session-await/awaits-overview').then(module => ({ default: module.AwaitsOverview })))

export const Route = createFileRoute('/awaits')({
  component: AwaitsRoute,
})

function AwaitsRoute() {
  return (
    <Suspense fallback={null}>
      <AwaitsOverview />
    </Suspense>
  )
}
