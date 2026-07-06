import { createFileRoute } from '@tanstack/react-router'

import { RouteErrorFallback } from '~/components/common/route-error-fallback'
import { DiffHomePage } from '~/features/diff-review/diff-home-page'
import { parseAnchorSide, parsePositiveInt } from '~/features/diff-review/shared/navigation'

interface DiffSearch {
  workspace?: string
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
  line?: number
  side?: 'base' | 'head'
}

export const Route = createFileRoute('/diff')({
  validateSearch: (search: Record<string, unknown>): DiffSearch => ({
    workspace: typeof search.workspace === 'string' && search.workspace.length > 0 ? search.workspace : undefined,
    repo: typeof search.repo === 'string' && search.repo.length > 0 ? search.repo : undefined,
    path: typeof search.path === 'string' && search.path.length > 0 ? search.path : undefined,
    review: typeof search.review === 'string' && search.review.length > 0 ? search.review : undefined,
    view: search.view === 'commit' || search.view === 'guide' ? search.view : undefined,
    line: parsePositiveInt(search.line),
    side: parseAnchorSide(search.side),
  }),
  errorComponent: RouteErrorFallback,
  component: DiffRoute,
})

function DiffRoute() {
  const navigate = Route.useNavigate()
  const { workspace, repo, path, review, view, line, side } = Route.useSearch()

  return (
    <DiffHomePage
      workspace={workspace}
      repo={repo}
      path={path}
      review={review}
      view={view}
      line={line}
      side={side}
      onWorkspaceSelect={(workspaceId) => {
        void navigate({
          search: {
            workspace: workspaceId,
          },
        })
      }}
    />
  )
}
