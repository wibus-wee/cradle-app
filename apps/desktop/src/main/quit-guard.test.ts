import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const app = {
    quit: vi.fn(),
  }
  const webContents = {
    send: vi.fn(),
  }
  const window = {
    isDestroyed: vi.fn(() => false),
    webContents,
  }

  return {
    app,
    BrowserWindow: {
      getAllWindows: vi.fn(() => [window]),
    },
    webContents,
    window,
  }
})

vi.mock('electron', () => electronMocks)

function createBeforeQuitEvent() {
  return {
    preventDefault: vi.fn(),
  } as unknown as Electron.Event & { preventDefault: ReturnType<typeof vi.fn> }
}

describe('quitGuard', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    electronMocks.app.quit.mockClear()
    electronMocks.BrowserWindow.getAllWindows.mockClear()
    electronMocks.webContents.send.mockClear()
    electronMocks.window.isDestroyed.mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('arms the first quit request and broadcasts renderer feedback', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()
    const event = createBeforeQuitEvent()

    expect(guard.handleBeforeQuit(event)).toBe(false)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(electronMocks.app.quit).not.toHaveBeenCalled()
    expect(electronMocks.webContents.send).toHaveBeenCalledWith('desktop:quit-guard-armed', {
      expiresAt: 3_000,
    })
  })

  it('requires the second quit request inside the armed window to trigger app quit', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()

    guard.handleBeforeQuit(createBeforeQuitEvent())
    const secondEvent = createBeforeQuitEvent()
    expect(guard.handleBeforeQuit(secondEvent)).toBe(false)

    expect(secondEvent.preventDefault).toHaveBeenCalled()
    expect(electronMocks.app.quit).not.toHaveBeenCalled()

    await Promise.resolve()

    expect(electronMocks.app.quit).toHaveBeenCalledTimes(1)
  })

  it('lets quit proceed when the desktop preference is disabled', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()
    guard.updatePreferences({ requireDoubleCommandQToQuit: false })
    const event = createBeforeQuitEvent()

    expect(guard.handleBeforeQuit(event)).toBe(true)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(electronMocks.webContents.send).not.toHaveBeenCalled()
  })

  it('lets an explicit programmatic quit bypass the guard once', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()
    const bypassedEvent = createBeforeQuitEvent()
    const nextEvent = createBeforeQuitEvent()

    guard.allowNextQuit()

    expect(guard.handleBeforeQuit(bypassedEvent)).toBe(true)
    expect(bypassedEvent.preventDefault).not.toHaveBeenCalled()

    expect(guard.handleBeforeQuit(nextEvent)).toBe(false)
    expect(nextEvent.preventDefault).toHaveBeenCalled()
  })
})
