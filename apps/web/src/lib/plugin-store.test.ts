/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'

import { usePluginStore } from './plugin-store'

function resetPluginStore(): void {
  usePluginStore.setState({
    panels: [],
    commands: [],
    webLayerStates: {},
  })
}

afterEach(() => {
  resetPluginStore()
})

describe('usePluginStore', () => {
  it('stores route segment and local id for web panel URL keys', () => {
    const dispose = usePluginStore.getState().registerPanel('@cradle/system-info', 'system-info', {
      id: 'system-info',
      title: 'System Info',
      component: () => null,
    })

    expect(usePluginStore.getState().panels).toMatchObject([{
      id: '@cradle/system-info:system-info',
      owner: '@cradle/system-info',
      routeSegment: 'system-info',
      localId: 'system-info',
      title: 'System Info',
    }])

    dispose()

    expect(usePluginStore.getState().panels).toEqual([])
  })

  it('stores owner-scoped web command registrations and clears them on dispose', () => {
    const execute = () => undefined

    const dispose = usePluginStore.getState().registerCommand('@cradle/system-info', {
      id: 'show-snapshot',
      title: 'Show System Info Snapshot',
      description: 'Fetch the latest host system snapshot.',
      keywords: ['system', 'host', 'snapshot'],
      category: 'System Info',
      keybinding: 'ctrl+shift+i',
      execute,
    })

    expect(usePluginStore.getState().commands).toMatchObject([{
      id: '@cradle/system-info:show-snapshot',
      owner: '@cradle/system-info',
      localId: 'show-snapshot',
      title: 'Show System Info Snapshot',
      description: 'Fetch the latest host system snapshot.',
      keywords: ['system', 'host', 'snapshot'],
      category: 'System Info',
      keybinding: 'ctrl+shift+i',
    }])
    expect(usePluginStore.getState().commands[0]?.execute).toBe(execute)

    dispose()

    expect(usePluginStore.getState().commands).toEqual([])
  })
})
