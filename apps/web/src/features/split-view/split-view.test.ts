import { beforeEach, describe, expect, it } from 'vitest'

import type { SurfaceRoute } from '~/navigation/surface-identity'

import { directionFromPoint } from './model/split-direction'
import { isSplitWorkspace, readSplitWorkspace, useSplitWorkspaceStore } from './store/split-workspace-store'

const CHAT_ROUTE: SurfaceRoute = { to: '/chat/$sessionId', params: { sessionId: 'primary' } }
const SURFACE_ID = 'chat:primary'

function resetStore() {
  useSplitWorkspaceStore.setState({ workspaces: {} })
}

describe('directionFromPoint', () => {
  const bounds = { left: 0, top: 0, width: 100, height: 100 }

  it('maps each quadrant triangle to its edge', () => {
    expect(directionFromPoint(bounds, { clientX: 10, clientY: 50 })).toBe('left')
    expect(directionFromPoint(bounds, { clientX: 90, clientY: 50 })).toBe('right')
    expect(directionFromPoint(bounds, { clientX: 50, clientY: 10 })).toBe('above')
    expect(directionFromPoint(bounds, { clientX: 50, clientY: 90 })).toBe('below')
  })

  it('resolves the exact centre deterministically instead of doing nothing', () => {
    // dx === dy === 0 falls through to the vertical branch — any pane drop
    // still splits rather than silently merging.
    expect(directionFromPoint(bounds, { clientX: 50, clientY: 50 })).toBe('above')
  })
})

describe('split workspace store', () => {
  beforeEach(resetStore)

  it('starts every surface as a single primary pane', () => {
    useSplitWorkspaceStore.getState().ensureWorkspace(SURFACE_ID, CHAT_ROUTE)
    const workspace = readSplitWorkspace(SURFACE_ID)!
    expect(workspace.primaryPaneId).toBe(SURFACE_ID)
    expect(Object.keys(workspace.panes)).toEqual([SURFACE_ID])
    expect(isSplitWorkspace(workspace)).toBe(false)
  })

  it('registers a secondary pane and refuses duplicates', () => {
    const store = useSplitWorkspaceStore.getState()
    store.ensureWorkspace(SURFACE_ID, CHAT_ROUTE)

    const other: SurfaceRoute = { to: '/chat/$sessionId', params: { sessionId: 'other' } }
    expect(store.registerPane(SURFACE_ID, other)).toMatch(/^pane:chat:other:/)
    expect(isSplitWorkspace(readSplitWorkspace(SURFACE_ID))).toBe(true)

    // Same route again is a no-op — a route is unique per surface.
    expect(store.registerPane(SURFACE_ID, other)).toBeNull()
    expect(Object.keys(readSplitWorkspace(SURFACE_ID)!.panes)).toHaveLength(2)
  })

  it('never forgets the primary pane', () => {
    const store = useSplitWorkspaceStore.getState()
    store.ensureWorkspace(SURFACE_ID, CHAT_ROUTE)
    store.forgetPane(SURFACE_ID, SURFACE_ID)
    expect(readSplitWorkspace(SURFACE_ID)!.panes[SURFACE_ID]).toBeDefined()
  })

  it('drops the persisted grid once a workspace falls back to one pane', () => {
    const store = useSplitWorkspaceStore.getState()
    store.ensureWorkspace(SURFACE_ID, CHAT_ROUTE)
    const paneId = store.registerPane(SURFACE_ID, { to: '/chat/$sessionId', params: { sessionId: 'other' } })
    if (!paneId) {
      throw new Error('Expected a secondary pane to be registered')
    }
    store.setLayout(SURFACE_ID, { grid: {} } as never)
    store.forgetPane(SURFACE_ID, paneId)
    expect(readSplitWorkspace(SURFACE_ID)!.layout).toBeNull()
  })

  it('keeps the primary pane route in step with the live surface route', () => {
    const store = useSplitWorkspaceStore.getState()
    const diff: SurfaceRoute = { to: '/diff', search: { repo: 'a' } }
    store.ensureWorkspace('diff', diff)
    // Same surface identity, changed search — the pane route should follow.
    store.ensureWorkspace('diff', { to: '/diff', search: { repo: 'b' } })
    expect(readSplitWorkspace('diff')!.panes.diff!.route).toEqual({ to: '/diff', search: { repo: 'b' } })
  })

  it('collapses to a fresh workspace when the persisted primary no longer matches', () => {
    // Simulate corrupt/stale persisted state: primary id disagrees with route.
    useSplitWorkspaceStore.setState({
      workspaces: {
        [SURFACE_ID]: {
          primaryPaneId: 'chat:stale',
          panes: { 'chat:stale': { id: 'chat:stale', route: CHAT_ROUTE } },
          focusedPaneId: 'chat:stale',
          layout: null,
        },
      },
    })
    useSplitWorkspaceStore.getState().ensureWorkspace(SURFACE_ID, CHAT_ROUTE)
    const workspace = readSplitWorkspace(SURFACE_ID)!
    expect(workspace.primaryPaneId).toBe(SURFACE_ID)
    expect(workspace.panes[SURFACE_ID]).toBeDefined()
  })
})
