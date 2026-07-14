// FILE: right-dock.logic.ts
// Purpose: Pure, reusable transitions for an owner-scoped tabbed right dock.
// Layer: Renderer UI state helpers

export interface RightDockPane {
  id: string
  kind: string
}

export interface RightDockThreadState<TPane extends RightDockPane> {
  open: boolean
  panes: TPane[]
  activePaneId: string | null
}

export interface RightDockPanePolicy<TPane extends RightDockPane> {
  isSingletonKind: (kind: TPane['kind']) => boolean
  matchesMultiInstancePane: (existing: TPane, incoming: TPane) => boolean
  mergeReopenedSingleton: (existing: TPane, incoming: TPane) => TPane
}

export function createDefaultRightDockState<TPane extends RightDockPane>(): RightDockThreadState<TPane> {
  return {
    open: false,
    panes: [],
    activePaneId: null,
  }
}

export function openPaneInState<TPane extends RightDockPane>(
  state: RightDockThreadState<TPane>,
  pane: TPane,
  policy: RightDockPanePolicy<TPane>,
): RightDockThreadState<TPane> {
  const existing = policy.isSingletonKind(pane.kind)
    ? state.panes.find(candidate => candidate.kind === pane.kind)
    : state.panes.find(candidate => policy.matchesMultiInstancePane(candidate, pane))

  if (existing) {
    const merged = policy.isSingletonKind(pane.kind)
      ? policy.mergeReopenedSingleton(existing, pane)
      : existing
    const nextPanes = merged === existing
      ? state.panes
      : state.panes.map(candidate => candidate.id === existing.id ? merged : candidate)
    if (state.open && state.activePaneId === existing.id && nextPanes === state.panes) {
      return state
    }
    return {
      open: true,
      panes: nextPanes,
      activePaneId: existing.id,
    }
  }

  return {
    open: true,
    panes: [...state.panes, pane],
    activePaneId: pane.id,
  }
}

export function closePaneInState<TPane extends RightDockPane>(
  state: RightDockThreadState<TPane>,
  paneId: string,
): RightDockThreadState<TPane> {
  const removedIndex = state.panes.findIndex(pane => pane.id === paneId)
  if (removedIndex === -1) {
    return state
  }

  const panes = state.panes.filter(pane => pane.id !== paneId)
  const activePaneId = state.activePaneId === paneId
    ? (panes[Math.max(0, removedIndex - 1)]?.id ?? null)
    : state.activePaneId

  return {
    open: panes.length > 0 ? state.open : false,
    panes,
    activePaneId: activePaneId && panes.some(pane => pane.id === activePaneId)
      ? activePaneId
      : (panes.at(-1)?.id ?? null),
  }
}

export function setActivePaneInState<TPane extends RightDockPane>(
  state: RightDockThreadState<TPane>,
  paneId: string,
): RightDockThreadState<TPane> {
  if (!state.panes.some(pane => pane.id === paneId)) {
    return state
  }
  if (state.open && state.activePaneId === paneId) {
    return state
  }
  return { ...state, open: true, activePaneId: paneId }
}

export function setDockOpenInState<TPane extends RightDockPane>(
  state: RightDockThreadState<TPane>,
  open: boolean,
): RightDockThreadState<TPane> {
  if (open && state.panes.length === 0) {
    return state
  }
  if (state.open === open) {
    return state
  }
  return { ...state, open }
}

export function resolveActivePane<TPane extends RightDockPane>(
  state: RightDockThreadState<TPane>,
): TPane | null {
  if (!state.open || state.activePaneId === null) {
    return null
  }
  return state.panes.find(pane => pane.id === state.activePaneId) ?? null
}
