import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const WorkAttention = lazy(() => import('~/features/work/work-attention').then(module => ({ default: module.WorkAttention })))

export const Route = createFileRoute('/awaits')({
  component: AwaitsRoute,
})

function AwaitsRoute() {
  return (
    <Suspense fallback={null}>
      <WorkAttention />
    </Suspense>
  )
}
