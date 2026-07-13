import { describe, expect, it } from 'vitest'

import {
  closePaneInState,
  createDefaultRightDockState,
  openPaneInState,
  setDockOpenInState,
} from './right-dock.logic'

interface TestPane {
  id: string
  kind: 'singleton' | 'multi'
  identity: string | null
  value: string | null
}

const policy = {
  isSingletonKind: (kind: TestPane['kind']) => kind === 'singleton',
  matchesMultiInstancePane: (existing: TestPane, incoming: TestPane) =>
    existing.kind === incoming.kind && existing.identity === incoming.identity,
  mergeReopenedSingleton: (existing: TestPane, incoming: TestPane): TestPane => ({
    ...existing,
    value: incoming.value ?? existing.value,
  }),
}

describe('right dock transitions', () => {
  it('reuses and updates singleton panes', () => {
    const first = openPaneInState(createDefaultRightDockState<TestPane>(), {
      id: 'first',
      kind: 'singleton',
      identity: null,
      value: 'old',
    }, policy)
    const reopened = openPaneInState(first, {
      id: 'ignored',
      kind: 'singleton',
      identity: null,
      value: 'new',
    }, policy)

    expect(reopened.panes).toEqual([expect.objectContaining({ id: 'first', value: 'new' })])
    expect(reopened.activePaneId).toBe('first')
  })

  it('reuses matching multi-instance panes and permits distinct identities', () => {
    const first = openPaneInState(createDefaultRightDockState<TestPane>(), {
      id: 'first',
      kind: 'multi',
      identity: 'a',
      value: null,
    }, policy)
    const second = openPaneInState(first, {
      id: 'second',
      kind: 'multi',
      identity: 'b',
      value: null,
    }, policy)
    const reopened = openPaneInState(second, {
      id: 'ignored',
      kind: 'multi',
      identity: 'a',
      value: null,
    }, policy)

    expect(reopened.panes.map(pane => pane.id)).toEqual(['first', 'second'])
    expect(reopened.activePaneId).toBe('first')
  })

  it('selects the previous neighbor and closes the dock after the last pane', () => {
    const state = {
      open: true,
      activePaneId: 'second',
      panes: [
        { id: 'first', kind: 'multi', identity: 'a', value: null },
        { id: 'second', kind: 'multi', identity: 'b', value: null },
        { id: 'third', kind: 'multi', identity: 'c', value: null },
      ] satisfies TestPane[],
    }
    const afterSecond = closePaneInState(state, 'second')
    const afterFirst = closePaneInState(afterSecond, 'first')
    const empty = closePaneInState(afterFirst, 'third')

    expect(afterSecond.activePaneId).toBe('first')
    expect(empty).toEqual({ open: false, panes: [], activePaneId: null })
  })

  it('does not open an empty dock', () => {
    const state = createDefaultRightDockState<TestPane>()
    expect(setDockOpenInState(state, true)).toBe(state)
  })
})
