import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { directionFromDropPoint } from './chat-split-drop-quadrant'
import { clearChatSplitHover, getChatSplitHover, setChatSplitHover } from './chat-split-hover'
import { splitSession } from './chat-split-session'

const addChatSplitDockviewSession = vi.hoisted(() => vi.fn())
const findChatSplitGroupAtPoint = vi.hoisted(() => vi.fn())
const addPane = vi.hoisted(() => vi.fn())

vi.mock('./chat-split-dockview-registry', () => ({
  addChatSplitDockviewSession: (...args: unknown[]) => addChatSplitDockviewSession(...args),
  findChatSplitGroupAtPoint: (...args: unknown[]) => findChatSplitGroupAtPoint(...args),
}))

vi.mock('./chat-split-workspace-store', () => ({
  useChatSplitWorkspaceStore: {
    getState: () => ({
      addPane: (...args: unknown[]) => addPane(...args),
    }),
  },
}))

describe('directionFromDropPoint', () => {
  const bounds = { left: 0, top: 0, width: 100, height: 100 }

  it('maps the four diagonal quadrants', () => {
    expect(directionFromDropPoint(bounds, { clientX: 80, clientY: 50 })).toBe('right')
    expect(directionFromDropPoint(bounds, { clientX: 20, clientY: 50 })).toBe('left')
    expect(directionFromDropPoint(bounds, { clientX: 50, clientY: 20 })).toBe('above')
    expect(directionFromDropPoint(bounds, { clientX: 50, clientY: 80 })).toBe('below')
  })
})

describe('splitSession', () => {
  beforeEach(() => {
    addChatSplitDockviewSession.mockReset()
    findChatSplitGroupAtPoint.mockReset()
    addPane.mockReset()
  })

  it('prefers the live dockview path when it accepts the session', () => {
    addChatSplitDockviewSession.mockReturnValue(true)

    expect(splitSession('chat:a', 'b', 'right')).toBe(true)
    expect(addChatSplitDockviewSession).toHaveBeenCalledWith('chat:a', 'b', 'right', undefined)
    expect(addPane).not.toHaveBeenCalled()
  })

  it('resolves the group under the pointer when coordinates are provided', () => {
    const group = { id: 'group-1' }
    findChatSplitGroupAtPoint.mockReturnValue(group)
    addChatSplitDockviewSession.mockReturnValue(true)

    expect(splitSession('chat:a', 'b', 'left', { clientX: 10, clientY: 20 })).toBe(true)
    expect(findChatSplitGroupAtPoint).toHaveBeenCalledWith('chat:a', 10, 20)
    expect(addChatSplitDockviewSession).toHaveBeenCalledWith('chat:a', 'b', 'left', group)
  })

  it('falls back to store addPane when dockview is not mounted', () => {
    addChatSplitDockviewSession.mockReturnValue(false)
    addPane.mockReturnValue(true)

    expect(splitSession('chat:a', 'b', 'below')).toBe(true)
    expect(addPane).toHaveBeenCalledWith('chat:a', 'b', 'below')
  })
})

describe('chat-split-hover', () => {
  const bounds = { left: 0, top: 0, width: 100, height: 200 }

  beforeEach(() => {
    clearChatSplitHover()
  })

  afterEach(() => {
    clearChatSplitHover()
  })

  it('stores surface-scoped hover and ignores clear for other surfaces', () => {
    setChatSplitHover({ surfaceId: 'chat:a', direction: 'left', bounds })
    expect(getChatSplitHover()).toEqual({ surfaceId: 'chat:a', direction: 'left', bounds })

    setChatSplitHover({ surfaceId: 'chat:b', direction: 'right', bounds })
    expect(getChatSplitHover()?.surfaceId).toBe('chat:b')

    clearChatSplitHover('chat:a')
    expect(getChatSplitHover()?.surfaceId).toBe('chat:b')

    clearChatSplitHover('chat:b')
    expect(getChatSplitHover()).toBeNull()
  })

  it('dedupes identical hover updates', () => {
    setChatSplitHover({ surfaceId: 'chat:a', direction: 'left', bounds })
    const first = getChatSplitHover()
    setChatSplitHover({ surfaceId: 'chat:a', direction: 'left', bounds })
    expect(getChatSplitHover()).toBe(first)
  })
})
