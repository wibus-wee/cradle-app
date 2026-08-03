import type { DockviewPanelApi, IDockviewPanelProps } from 'dockview-react'
import { lazy, Suspense, useEffect, useState } from 'react'

import { cn } from '~/lib/utils'
import { SurfaceActivityProvider } from '~/navigation/surface-activity-context'

import { useSplitPane } from '../store/split-workspace-store'
import { useSplitPaneHost } from './split-pane-host-context'

/** Panel component id registered with dockview. */
export const SPLIT_PANE_COMPONENT = 'splitPane'

/**
 * Panel params are persisted inside dockview's serialized layout, so they hold
 * the pane id only — the route itself is looked up from the store.
 */
export interface SplitPaneParams {
  paneId: string
}

/**
 * Loaded on demand: a pane router is only ever needed once a surface is
 * actually split, and keeping it out of the initial graph also breaks the
 * import cycle between the route tree and the shell that hosts it.
 */
const SplitPaneRouter = lazy(() =>
  import('./split-pane-router').then(module => ({ default: module.SplitPaneRouter })))

/**
 * `panelApi.isActive` means "selected tab of the *globally focused* group" —
 * with a left/right split only the focused side ever reports `true`, which is
 * wrong for "is this pane on screen". `isVisible` tracks whether the panel is
 * the shown tab of its own group, which is true for every simultaneously
 * visible pane regardless of which one holds focus.
 */
function useDockviewPanelVisible(api: DockviewPanelApi): boolean {
  const [visible, setVisible] = useState(api.isVisible)

  useEffect(() => {
    setVisible(api.isVisible)
    return api.onDidVisibilityChange(event => setVisible(event.isVisible)).dispose
  }, [api])

  return visible
}

/**
 * `isGroupActive` tracks whether this panel's group holds dockview-wide focus.
 * Used only for the "dim the unfocused split" treatment — mount and activity
 * behaviour follow `isVisible` above.
 */
function useDockviewPanelGroupActive(api: DockviewPanelApi): boolean {
  const [groupActive, setGroupActive] = useState(api.isGroupActive)

  useEffect(() => {
    setGroupActive(api.isGroupActive)
    return api.onDidActiveGroupChange(event => setGroupActive(event.isActive)).dispose
  }, [api])

  return groupActive
}

export function SplitPaneContent({ api, params }: IDockviewPanelProps<SplitPaneParams>) {
  const host = useSplitPaneHost()
  const isVisible = useDockviewPanelVisible(api)
  const isGroupActive = useDockviewPanelGroupActive(api)
  const pane = useSplitPane(host?.surfaceId ?? '', params.paneId)

  if (!host) {
    return null
  }

  const isPrimary = params.paneId === host.primaryPaneId

  return (
    <SurfaceActivityProvider active={isVisible}>
      <div
        className={cn(
          'h-full w-full transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
          !isGroupActive && 'opacity-50',
        )}
      >
        {isPrimary
          ? host.primaryContent
          : pane && (
            <Suspense fallback={null}>
              <SplitPaneRouter
                surfaceId={host.surfaceId}
                paneId={pane.id}
                route={pane.route}
              />
            </Suspense>
          )}
      </div>
    </SurfaceActivityProvider>
  )
}
