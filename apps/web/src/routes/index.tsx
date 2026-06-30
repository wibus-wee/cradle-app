import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const HomeDashboard = lazy(() => import('~/features/home/home-dashboard').then(module => ({ default: module.HomeDashboard })))

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <Suspense fallback={null}>
      <HomeDashboard />
    </Suspense>
  )
}
