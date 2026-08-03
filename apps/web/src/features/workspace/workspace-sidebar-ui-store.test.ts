import { afterEach, describe, expect, it } from 'vitest'

import { useWorkspaceSidebarUiStore } from './workspace-sidebar-ui-store'

const PERSIST_KEY = 'cradle:workspace-sidebar-ui:v1'

const initialState = useWorkspaceSidebarUiStore.getInitialState()

async function rehydrateFrom(persisted: { state: Record<string, unknown>, version: number }) {
  globalThis.localStorage.setItem(PERSIST_KEY, JSON.stringify(persisted))
  await useWorkspaceSidebarUiStore.persist.rehydrate()
}

afterEach(() => {
  globalThis.localStorage.removeItem(PERSIST_KEY)
  useWorkspaceSidebarUiStore.setState(initialState, true)
})

describe('workspace sidebar ui store v3 → v4 migration', () => {
  it('maps the recent-session sort to the updated grouping', async () => {
    await rehydrateFrom({
      version: 3,
      state: {
        projectScope: 'all',
        projectSortKey: 'recentSession',
        projectSortDirection: 'desc',
        projectPinnedFirst: true,
        statusFilters: ['unread'],
        workPrFilters: [],
        sourceFilters: [],
        showArchived: false,
      },
    })

    const state = useWorkspaceSidebarUiStore.getState()
    expect(state.grouping).toBe('updated')
    expect(state.sessionOrdering).toBe('updated')
    expect(state.orderingDirection).toBe('desc')
    expect(state.statusFilters).toEqual(['unread'])
  })

  it('maps the created-at project sort to the created session ordering', async () => {
    await rehydrateFrom({
      version: 3,
      state: {
        projectSortKey: 'createdAt',
        projectSortDirection: 'asc',
        projectPinnedFirst: false,
      },
    })

    const state = useWorkspaceSidebarUiStore.getState()
    expect(state.grouping).toBe('workspace')
    expect(state.sessionOrdering).toBe('created')
    expect(state.orderingDirection).toBe('asc')
  })

  it('drops scope and pinned-first without a replacement', async () => {
    await rehydrateFrom({
      version: 3,
      state: {
        projectScope: 'pinned',
        projectPinnedFirst: false,
      },
    })

    const state = useWorkspaceSidebarUiStore.getState()
    expect(state.grouping).toBe('workspace')
    expect(state).not.toHaveProperty('projectScope')
    expect(state).not.toHaveProperty('projectPinnedFirst')
  })

  it('normalizes invalid persisted values back to defaults', async () => {
    await rehydrateFrom({
      version: 4,
      state: {
        grouping: 'repository',
        sessionOrdering: 'name',
        orderingDirection: 'sideways',
        environmentFilters: ['local', 'nope'],
      },
    })

    const state = useWorkspaceSidebarUiStore.getState()
    expect(state.grouping).toBe('workspace')
    expect(state.sessionOrdering).toBe('updated')
    expect(state.orderingDirection).toBe('desc')
    expect(state.environmentFilters).toEqual(['local'])
  })
})

describe('environment filters', () => {
  it('toggles local/remote facets and counts them as active filters', () => {
    const store = useWorkspaceSidebarUiStore.getState()
    store.toggleEnvironmentFilter('remote')
    expect(useWorkspaceSidebarUiStore.getState().environmentFilters).toEqual(['remote'])

    useWorkspaceSidebarUiStore
      .getState()
      .toggleEnvironmentFilter('remote')
    expect(useWorkspaceSidebarUiStore.getState().environmentFilters).toEqual([])
  })
})
