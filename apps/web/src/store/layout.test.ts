import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLayoutStore } from './layout'

describe('layout store updates', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      asideOpen: false,
      asideActiveTab: 'files',
      browserPanelRatio: 0.4,
      bottomPanelOpen: true,
    })
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
    })
    const firstStore = useLayoutStore

    vi.resetModules()
    const { useLayoutStore: reloadedStore } = await import('./layout')

    expect(reloadedStore).toBe(firstStore)
    expect(reloadedStore.getState()).toMatchObject({
      asideOpen: true,
      asideActiveTab: 'adjustment',
    })
  })
})
