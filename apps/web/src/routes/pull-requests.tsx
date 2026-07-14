import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import { RouteErrorFallback } from '~/components/common/route-error-fallback'
import { PullRequestsPage } from '~/features/pull-requests/pull-requests-page'

interface PullRequestsSearch {
  pr?: string
}

export const Route = createFileRoute('/pull-requests')({
  validateSearch: (search: Record<string, unknown>): PullRequestsSearch => ({
    pr: typeof search.pr === 'string' && search.pr.length > 0 ? search.pr : undefined,
  }),
  errorComponent: RouteErrorFallback,
  component: PullRequestsRoute,
})

function PullRequestsRoute() {
  const { pr } = Route.useSearch()
  const navigate = useNavigate({ from: '/pull-requests' })
  const setSelectedRef = useCallback((nextRef?: string) => {
    void navigate({ search: { pr: nextRef }, replace: true })
  }, [navigate])

  return (
    <PullRequestsPage
      selectedRef={pr}
      onSelectedRefChange={setSelectedRef}
    />
  )
}
