import { createMemoryHistory, createRouter, RouterProvider, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useRef } from 'react'

import { RouteErrorFallback } from '~/components/common/route-error-fallback'
import type { SurfaceRoute } from '~/navigation/surface-identity'
import { surfaceDraftFromRoute } from '~/navigation/surface-identity'

import { useSplitWorkspaceStore } from '../store/split-workspace-store'
import { SplitPaneRootProvider } from './split-pane-root-context'

/**
 * Renders a secondary split pane by running the application's own route tree
 * against a private in-memory location.
 *
 * The alternative — a hand-written map from route to page component — would be
 * a second, silently diverging copy of the router: no loaders, no error
 * components, no pending states, and a new maintenance burden every time a
 * route is added. Here a pane gets all of that for free, and navigating inside
 * a pane (following a link, switching a tab within a page) stays contained to
 * that pane instead of moving the window's URL.
 */
export function SplitPaneRouter({
  surfaceId,
  paneId,
  route,
}: {
  surfaceId: string
  paneId: string
  route: SurfaceRoute
}) {
  const hostRouter = useRouter()
  // Reading the href off the host router keeps path building in one place and
  // avoids importing the router singleton (which owns this module's route
  // tree) back into the pane runtime.
  const href = hostRouter.buildLocation(route as Parameters<typeof hostRouter.buildLocation>[0]).href
  const initialHref = useRef(href).current

  const paneRouter = useMemo(
    () =>
      createRouter({
        // Reuse the initialized host tree. Importing the generated tree from
        // this lazy chunk can re-enter router initialization during Vite HMR.
        routeTree: hostRouter.routeTree,
        history: createMemoryHistory({ initialEntries: [initialHref] }),
        defaultErrorComponent: RouteErrorFallback,
        defaultPendingComponent: () => null,
        // Panes are already-decided destinations; hover preloading inside one
        // would warm routes the user cannot navigate the window to anyway.
        defaultPreload: false,
      }),
    [hostRouter.routeTree, initialHref],
  )

  useEffect(() => {
    if (paneRouter.state.location.href === href) {
      return
    }
    void paneRouter.navigate({
      ...route,
      replace: true,
    } as Parameters<typeof paneRouter.navigate>[0])
  }, [href, paneRouter, route])

  useEffect(() => {
    return paneRouter.subscribe('onResolved', (event) => {
      const match = paneRouter.state.matches.at(-1)
      const draft = surfaceDraftFromRoute({
        pathname: event.toLocation.pathname,
        params: match?.params,
        search: event.toLocation.search,
      })
      if (draft) {
        useSplitWorkspaceStore.getState().updatePaneRoute(surfaceId, paneId, draft.route)
      }
    })
  }, [paneId, paneRouter, surfaceId])

  return (
    <SplitPaneRootProvider value={{ surfaceId, paneId }}>
      <RouterProvider router={paneRouter} />
    </SplitPaneRootProvider>
  )
}
