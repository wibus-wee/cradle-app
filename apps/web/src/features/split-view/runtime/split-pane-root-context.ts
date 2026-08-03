import { createContext, use } from 'react'

/**
 * Marks the React subtree of a secondary split pane.
 *
 * A pane renders the app's real route tree through its own router, which means
 * the root route component runs again inside the pane. It must not paint a
 * second app shell there — sidebar, surface bar, global dialogs and route ⇢
 * surface syncing all belong to the window, not to a pane. The root route
 * checks this flag and renders a bare outlet instead.
 *
 * Deliberately dependency-free: the root route imports it, and so does the
 * pane runtime that the root route transitively pulls in.
 */
export interface SplitPaneRoot {
  surfaceId: string
  paneId: string
}

const SplitPaneRootContext = createContext<SplitPaneRoot | null>(null)

export const SplitPaneRootProvider = SplitPaneRootContext.Provider

export function useSplitPaneRoot(): SplitPaneRoot | null {
  return use(SplitPaneRootContext)
}

export function useIsSplitPaneRoot(): boolean {
  return useSplitPaneRoot() !== null
}
