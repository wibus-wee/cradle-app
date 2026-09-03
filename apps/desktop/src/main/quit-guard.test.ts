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

  it('arms the first Command+Q and broadcasts renderer feedback', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()

    guard.handleCommandQ()

    expect(electronMocks.app.quit).not.toHaveBeenCalled()
    expect(electronMocks.webContents.send).toHaveBeenCalledWith('desktop:quit-guard-armed', {
      expiresAt: 3_000,
    })
  })

  it('requires the second Command+Q inside the armed window to trigger app quit', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()

    guard.handleCommandQ()
    guard.handleCommandQ()

    expect(electronMocks.app.quit).toHaveBeenCalledTimes(1)
  })

  it('lets quit proceed when the desktop preference is disabled', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()
    guard.updatePreferences({ requireDoubleCommandQToQuit: false })

    guard.handleCommandQ()

    expect(electronMocks.app.quit).toHaveBeenCalledTimes(1)
    expect(electronMocks.webContents.send).not.toHaveBeenCalled()
  })

  it('requires a fresh pair after a completed Command+Q sequence', async () => {
    const { QuitGuard } = await import('./quit-guard')
    const guard = new QuitGuard()

    guard.handleCommandQ()
    guard.handleCommandQ()
    guard.handleCommandQ()

    expect(electronMocks.app.quit).toHaveBeenCalledTimes(1)
    expect(electronMocks.webContents.send).toHaveBeenCalledTimes(2)
  })
})
