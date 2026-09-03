import { beforeEach, describe, expect, it } from 'vitest'

import { HOME_SURFACE, HOME_SURFACE_ID } from './surface-identity'
import { readPersistedSurfaceState, useSurfaceStore } from './surface-store'

const SURFACE_STORAGE_KEY = 'cradle:surfaces:v1'

describe('surface store persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useSurfaceStore.setState({ surfaces: [HOME_SURFACE], lastClosedSurface: null })
  })

  it('drops invalid persisted surfaces and keeps valid old payload entries', async () => {
    localStorage.setItem(SURFACE_STORAGE_KEY, JSON.stringify({
      state: {
        surfaces: [
          {
            id: 'chat:valid-session',
            kind: 'chat',
            title: 'Chat',
            route: { to: '/chat/$sessionId', params: { sessionId: 'valid-session' } },
            order: 0,
            closable: true,
          },
          {
            id: 'chat:broken-session',
            kind: 'chat',
            title: 'Broken chat',
            route: { to: '/chat/$sessionId', params: {} },
            order: 1,
            closable: true,
          },
        ],
      },
    }))

    await useSurfaceStore.persist.rehydrate()

    expect(new Set(useSurfaceStore.getState().surfaces.map(surface => surface.id))).toEqual(
      new Set([HOME_SURFACE_ID, 'chat:valid-session']),
    )
  })

  it('falls back to the home surface when every persisted surface is invalid', async () => {
    localStorage.setItem(SURFACE_STORAGE_KEY, JSON.stringify({
      state: {
        surfaces: [
          {
            id: 'workspace:broken',
            kind: 'workspace',
            title: 'Broken workspace',
            route: { to: '/workspaces/$workspaceId', params: {} },
            order: 0,
            closable: true,
          },
        ],
      },
    }))

    await useSurfaceStore.persist.rehydrate()

    expect(useSurfaceStore.getState().surfaces).toEqual([HOME_SURFACE])
  })

  it('does not throw when parsing a corrupt persisted surface payload', () => {
    expect(readPersistedSurfaceState({ surfaces: 'not-an-array' })).toEqual({
      surfaces: [HOME_SURFACE],
    })
  })

  it('restores persisted Work surfaces', () => {
    const state = readPersistedSurfaceState({
      surfaces: [{
        id: 'work:work-1',
        kind: 'work',
        title: 'Fix retries',
        route: { to: '/work/$workId', params: { workId: 'work-1' } },
        order: 1,
        closable: true,
      }],
    })

    expect(state.surfaces.some(surface => surface.id === 'work:work-1')).toBe(true)
  })

  it('preserves New Chat workspace and session-group context', () => {
    const state = readPersistedSurfaceState({
      surfaces: [{
        id: 'new-chat',
        kind: 'new-chat',
        title: 'New Chat',
        route: {
          to: '/chat/new',
          search: {
            workspaceId: 'workspace-1',
            sessionGroupId: 'group-1',
          },
        },
        order: 1,
        closable: true,
      }],
    })

    expect(state.surfaces.find(surface => surface.id === 'new-chat')?.route).toEqual({
      to: '/chat/new',
      search: {
        workspaceId: 'workspace-1',
        sessionGroupId: 'group-1',
      },
    })
  })

  it('keeps one closed surface available until that surface is reopened', () => {
    const closedSurface = {
      id: 'chat:session-1',
      kind: 'chat' as const,
      title: 'Investigate retries',
      route: { to: '/chat/$sessionId' as const, params: { sessionId: 'session-1' } },
      order: 1,
      closable: true,
    }
    const store = useSurfaceStore.getState()
    store.syncSurface(closedSurface)
    store.rememberClosedSurface(closedSurface)
    store.closeSurface(closedSurface.id)

    expect(useSurfaceStore.getState().lastClosedSurface).toEqual(closedSurface)

    useSurfaceStore.getState().syncSurface(closedSurface)

    expect(useSurfaceStore.getState().lastClosedSurface).toBeNull()
    expect(useSurfaceStore.getState().surfaces).toContainEqual(closedSurface)
  })

  it('does not persist the closed-surface recovery target', () => {
    const closedSurface = {
      id: 'work:work-2',
      kind: 'work' as const,
      title: 'Ship recovery',
      route: { to: '/work/$workId' as const, params: { workId: 'work-2' } },
      order: 1,
      closable: true,
    }
    useSurfaceStore.getState().rememberClosedSurface(closedSurface)

    const stored = JSON.parse(localStorage.getItem(SURFACE_STORAGE_KEY) ?? '{}') as {
      state?: Record<string, unknown>
    }

    expect(stored.state?.lastClosedSurface).toBeUndefined()
  })
})
