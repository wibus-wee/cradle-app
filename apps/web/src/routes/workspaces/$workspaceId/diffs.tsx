import { createFileRoute } from '@tanstack/react-router'

import { RouteErrorFallback } from '~/components/common/route-error-fallback'
import { WorkspaceDiffsView } from '~/features/diff-review/workspace-diffs-view'
import { parseAnchorSide, parsePositiveInt } from '~/features/diff-review/shared/navigation'

interface WorkspaceDiffsSearch {
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
  line?: number
  side?: 'base' | 'head'
}

export const Route = createFileRoute('/workspaces/$workspaceId/diffs')({
  validateSearch: (search: Record<string, unknown>): WorkspaceDiffsSearch => ({
    repo: typeof search.repo === 'string' && search.repo.length > 0 ? search.repo : undefined,
    path: typeof search.path === 'string' && search.path.length > 0 ? search.path : undefined,
    review: typeof search.review === 'string' && search.review.length > 0 ? search.review : undefined,
    view: search.view === 'commit' || search.view === 'guide' ? search.view : undefined,
    line: parsePositiveInt(search.line),
    side: parseAnchorSide(search.side),
  }),
  errorComponent: RouteErrorFallback,
  component: WorkspaceDiffsRoute,
})

function WorkspaceDiffsRoute() {
  const { workspaceId } = Route.useParams()
  const { repo, path, review, view, line, side } = Route.useSearch()
  return (
    <WorkspaceDiffsView
      workspaceId={workspaceId}
      repo={repo}
      path={path}
      review={review}
      view={view}
      line={line}
      side={side}
    />
  )
}
