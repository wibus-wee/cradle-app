import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LAYOUT_BROWSER_PANEL_OWNER_ID, useLayoutStore } from './layout'

describe('layout store updates', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      activeBrowserPanelOwnerId: DEFAULT_LAYOUT_BROWSER_PANEL_OWNER_ID,
      asideOpen: false,
      asideActiveTab: 'files',
      browserPanelOpen: true,
      browserPanelOpenByOwnerId: { [DEFAULT_LAYOUT_BROWSER_PANEL_OWNER_ID]: true },
      browserPanelRatio: 0.4,
      bottomPanelOpen: true,
    })
  })

  it('does not notify subscribers when setting the browser panel to its current state', () => {
    const listener = vi.fn()
    const unsubscribe = useLayoutStore.subscribe(listener)

    useLayoutStore.getState().setBrowserPanelOpen(true)

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not notify subscribers when the clamped browser panel ratio is unchanged', () => {
    const listener = vi.fn()
    const unsubscribe = useLayoutStore.subscribe(listener)

    useLayoutStore.getState().setBrowserPanelRatio(0.4)

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the layout store instance across module reloads in dev', async () => {
    useLayoutStore.setState({
      asideOpen: true,
      asideActiveTab: 'adjustment',
      activeBrowserPanelOwnerId: 'workspace:one',
      browserPanelOpen: true,
      browserPanelOpenByOwnerId: { 'workspace:one': true },
    })
    const firstStore = useLayoutStore

    vi.resetModules()
    const { useLayoutStore: reloadedStore } = await import('./layout')

    expect(reloadedStore).toBe(firstStore)
    expect(reloadedStore.getState()).toMatchObject({
      asideOpen: true,
      asideActiveTab: 'adjustment',
      activeBrowserPanelOwnerId: 'workspace:one',
      browserPanelOpen: true,
      browserPanelOpenByOwnerId: { 'workspace:one': true },
    })
  })
})
