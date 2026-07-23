import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetTerminalLifetimeControllerForTests,
  TerminalLifetimeController,
} from './terminal-lifetime-controller'

describe('terminalLifetimeController', () => {
  beforeEach(() => {
    __resetTerminalLifetimeControllerForTests()
  })

  it('parks without stopping and coalesces concurrent stops', async () => {
    let resolveStop!: () => void
    const stopShell = vi.fn(() => new Promise<void>((resolve) => {
      resolveStop = resolve
    }))
    const controller = new TerminalLifetimeController({ stopShell })

    controller.register({
      terminalId: 'terminal:chat:1:1',
      adapterKind: 'bottom-panel',
      ownerId: 'chat:1',
    })
    controller.attach('terminal:chat:1:1')
    controller.park('terminal:chat:1:1')
    expect(controller.getPhase('terminal:chat:1:1')).toBe('parked')
    expect(stopShell).not.toHaveBeenCalled()

    const first = controller.stop('terminal:chat:1:1')
    const second = controller.stop('terminal:chat:1:1')
    expect(stopShell).toHaveBeenCalledTimes(1)

    resolveStop()
    await Promise.all([first, second])
    expect(controller.getPhase('terminal:chat:1:1')).toBe('stopped')
  })

  it('records natural exit without issuing stop and keeps failed stops retryable', async () => {
    const stopShell = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined)
    const controller = new TerminalLifetimeController({ stopShell })

    controller.register({
      terminalId: 'terminal:chat:1:2',
      adapterKind: 'bottom-panel',
      ownerId: 'chat:1',
    })
    controller.attach('terminal:chat:1:2')
    controller.recordExited('terminal:chat:1:2')
    await controller.stop('terminal:chat:1:2')
    expect(stopShell).not.toHaveBeenCalled()
    expect(controller.getPhase('terminal:chat:1:2')).toBe('exited')

    controller.register({
      terminalId: 'terminal:chat:1:3',
      adapterKind: 'bottom-panel',
      ownerId: 'chat:1',
    })
    controller.attach('terminal:chat:1:3')
    await expect(controller.stop('terminal:chat:1:3')).rejects.toThrow('network')
    expect(controller.getPhase('terminal:chat:1:3')).toBe('attached')
    await controller.stop('terminal:chat:1:3')
    expect(stopShell).toHaveBeenCalledTimes(2)
    expect(controller.getPhase('terminal:chat:1:3')).toBe('stopped')
  })

  it('releases a CLI TUI view without stopping its server PTY', () => {
    const stopCliTui = vi.fn(async () => {})
    const disposeCliTuiRuntime = vi.fn()
    const controller = new TerminalLifetimeController({ stopCliTui, disposeCliTuiRuntime })

    controller.register({
      terminalId: 'session-parked',
      adapterKind: 'cli-tui',
      ownerId: 'chat:session-parked',
    })
    controller.attach('session-parked')
    controller.releaseView('session-parked')

    expect(controller.getPhase('session-parked')).toBe('parked')
    expect(disposeCliTuiRuntime).toHaveBeenCalledWith('session-parked')
    expect(stopCliTui).not.toHaveBeenCalled()
  })

  it('disposes an owner by stopping each live terminal once', async () => {
    const stopShell = vi.fn(async () => {})
    const stopCliTui = vi.fn(async () => {})
    const disposeCliTuiRuntime = vi.fn()
    const controller = new TerminalLifetimeController({
      stopShell,
      stopCliTui,
      disposeCliTuiRuntime,
    })

    controller.register({
      terminalId: 'session-1',
      adapterKind: 'cli-tui',
      ownerId: 'chat:session-1',
    })
    controller.register({
      terminalId: 'terminal:chat:session-1:1',
      adapterKind: 'bottom-panel',
      ownerId: 'chat:session-1',
    })
    controller.attach('session-1')
    controller.attach('terminal:chat:session-1:1')

    await controller.disposeOwner('chat:session-1')

    expect(stopCliTui).toHaveBeenCalledWith('session-1')
    expect(disposeCliTuiRuntime).toHaveBeenCalledWith('session-1')
    expect(stopShell).toHaveBeenCalledWith('terminal:chat:session-1:1')
  })
})
