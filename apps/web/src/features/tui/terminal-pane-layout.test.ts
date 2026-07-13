import { describe, expect, it } from 'vitest'

import {
  activateTerminalSession,
  addTerminalTab,
  collectTerminalSessionIds,
  createTerminalPane,
  removeTerminalSession,
  resizeTerminalSplit,
  splitTerminalPane,
} from './terminal-pane-layout'

describe('terminal pane layout', () => {
  it('keeps tabs in one pane and splits a new session into a second visible pane', () => {
    const tabbed = addTerminalTab(createTerminalPane('one'), 'one', 'two')
    const layout = splitTerminalPane({
      node: tabbed,
      targetSessionId: 'two',
      newSessionId: 'three',
      direction: 'horizontal',
    })

    expect(layout).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'terminal', sessionIds: ['one', 'two'], activeSessionId: 'two' },
        { type: 'terminal', sessionIds: ['three'], activeSessionId: 'three' },
      ],
    })
    expect(collectTerminalSessionIds(layout)).toEqual(['one', 'two', 'three'])
  })

  it('activates a hidden tab without rebuilding the surrounding split', () => {
    const layout = splitTerminalPane({
      node: addTerminalTab(createTerminalPane('one'), 'one', 'two'),
      targetSessionId: 'two',
      newSessionId: 'three',
      direction: 'vertical',
    })

    const activated = activateTerminalSession(layout, 'one')

    expect(activated).toMatchObject({
      type: 'split',
      children: [{ activeSessionId: 'one' }, { activeSessionId: 'three' }],
    })
  })

  it('collapses a split when its last terminal pane is closed', () => {
    const layout = splitTerminalPane({
      node: createTerminalPane('one'),
      targetSessionId: 'one',
      newSessionId: 'two',
      direction: 'horizontal',
    })

    expect(removeTerminalSession(layout, 'two')).toEqual(createTerminalPane('one'))
  })

  it('applies drag weights to the targeted split', () => {
    const layout = splitTerminalPane({
      node: createTerminalPane('one'),
      targetSessionId: 'one',
      newSessionId: 'two',
      direction: 'horizontal',
    })
    expect(layout.type).toBe('split')
    if (layout.type !== 'split') {
      return
    }

    expect(resizeTerminalSplit(layout, layout.id, [1.4, 0.6])).toMatchObject({
      type: 'split',
      weights: [1.4, 0.6],
    })
  })
})
