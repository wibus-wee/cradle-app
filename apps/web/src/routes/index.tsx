import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const loadHomeDashboard = () => import('~/features/home/home-dashboard')
const homeDashboardPromise = isInitialHomeRoute() ? loadHomeDashboard() : null
const HomeDashboard = lazy(() => (homeDashboardPromise ?? loadHomeDashboard()).then(module => ({ default: module.HomeDashboard })))

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

function isInitialHomeRoute(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.location.hash === '' || window.location.hash === '#' || window.location.hash === '#/'
}
