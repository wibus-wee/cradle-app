import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { ActiveRun } from '../run-registry'
import { createActiveRunChunkLog } from '../stream/run-chunk-log'
import { createFinalMessageProjectionState } from './final-message-projection'
import { createActiveTurnCompletionController } from './turn-completion'

function activeRun(): ActiveRun {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    providerTargetKind: null,
    providerTargetId: null,
    runtime: {} as ActiveRun['runtime'],
    runtimeSession: {
      id: 'runtime-session-1',
      chatSessionId: 'session-1',
      providerTargetId: null,
      runtimeKind: 'standard',
      providerSessionId: null,
      providerStateSnapshot: null,
    },
    modelId: null,
    runChunkLog: createActiveRunChunkLog('run-1'),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: 'message-1', role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    usageEventCount: 0,
    usageEventAggregate: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotDroppedEventCount: 0,
  }
}

describe('active turn completion owner', () => {
  it('orders durable terminal, required bookkeeping, release, notification, best-effort, and handoff', async () => {
    const order: string[] = []
    const terminalChunk: UIMessageChunk = { type: 'finish', finishReason: 'stop' }
    const controller = createActiveTurnCompletionController({
      persistTerminalChunk: vi.fn(async () => {
        order.push('durable-terminal')
        return { durableTerminal: true, notificationChunk: terminalChunk }
      }),
      publishTerminalNotification: vi.fn(() => order.push('notification')),
      recoverTerminalPersistenceFailure: vi.fn(),
      releaseActiveRun: vi.fn(() => order.push('release')),
      performHandoff: vi.fn(() => order.push('handoff')),
      recordTerminalPersistenceIncident: vi.fn(),
      warn: vi.fn(),
    })

    await controller.completeActiveTurn(activeRun(), {
      source: 'normal',
      terminalChunk,
      requiredBookkeeping: async () => {
        order.push('required')
      },
      bestEffortBookkeeping: async () => {
        order.push('best-effort')
      },
      resolveHandoff: () => ({ kind: 'queue' }),
    })

    expect(order).toEqual([
      'durable-terminal',
      'required',
      'release',
      'notification',
      'best-effort',
      'handoff',
    ])
  })

  it('releases and notifies before best-effort bookkeeping that never settles', async () => {
    const order: string[] = []
    const terminalChunk: UIMessageChunk = { type: 'abort', reason: 'user' }
    let resolveBestEffort: (() => void) | undefined
    const bestEffortGate = new Promise<void>((resolve) => {
      resolveBestEffort = resolve
    })
    const controller = createActiveTurnCompletionController({
      persistTerminalChunk: vi.fn(async () => {
        order.push('durable-terminal')
        return { durableTerminal: true, notificationChunk: terminalChunk }
      }),
      publishTerminalNotification: vi.fn(() => order.push('notification')),
      recoverTerminalPersistenceFailure: vi.fn(),
      releaseActiveRun: vi.fn(() => order.push('release')),
      performHandoff: vi.fn(() => order.push('handoff')),
      recordTerminalPersistenceIncident: vi.fn(),
      warn: vi.fn(),
    })

    const completion = controller.completeActiveTurn(activeRun(), {
      source: 'cancel',
      terminalChunk,
      bestEffortBookkeeping: async () => {
        order.push('best-effort-started')
        await bestEffortGate
        order.push('best-effort-done')
      },
      resolveHandoff: () => ({ kind: 'none' }),
    })

    await vi.waitFor(() => {
      expect(order).toEqual([
        'durable-terminal',
        'release',
        'notification',
        'best-effort-started',
      ])
    })

    resolveBestEffort?.()
    await completion
    expect(order).toEqual([
      'durable-terminal',
      'release',
      'notification',
      'best-effort-started',
      'best-effort-done',
      'handoff',
    ])
  })

  it('observes terminal and recovery failure without notification or handoff and releases once', async () => {
    const terminalError = new Error('terminal write failed')
    const recoveryError = new Error('recovery write failed')
    const publishTerminalNotification = vi.fn()
    const releaseActiveRun = vi.fn()
    const performHandoff = vi.fn()
    const recordTerminalPersistenceIncident = vi.fn()
    const controller = createActiveTurnCompletionController({
      persistTerminalChunk: vi.fn().mockRejectedValue(terminalError),
      publishTerminalNotification,
      recoverTerminalPersistenceFailure: vi.fn().mockRejectedValue(recoveryError),
      releaseActiveRun,
      performHandoff,
      recordTerminalPersistenceIncident,
      warn: vi.fn(),
    })
    const run = activeRun()
    const outcome = {
      source: 'normal' as const,
      terminalChunk: { type: 'finish', finishReason: 'stop' } as const,
    }

    const first = controller.completeActiveTurn(run, outcome)
    const second = controller.completeActiveTurn(run, outcome)
    await expect(first).rejects.toThrow('terminal write failed')
    await expect(second).rejects.toThrow('terminal write failed')

    expect(publishTerminalNotification).not.toHaveBeenCalled()
    expect(performHandoff).not.toHaveBeenCalled()
    expect(releaseActiveRun).toHaveBeenCalledTimes(1)
    expect(recordTerminalPersistenceIncident).toHaveBeenCalledWith({
      activeRun: run,
      source: 'normal',
      terminalError,
      recoveryError,
    })
  })

  it('uses the recovered canonical terminal for bookkeeping, notification, release, and handoff', async () => {
    const order: string[] = []
    const terminalError = new Error('terminal write failed')
    const recoveredTerminal: UIMessageChunk = {
      type: 'error',
      errorText: 'Response interrupted because the Cradle server process exited while the run was streaming.',
    }
    const controller = createActiveTurnCompletionController({
      persistTerminalChunk: vi.fn().mockRejectedValue(terminalError),
      publishTerminalNotification: vi.fn((_activeRun, chunk) => {
        expect(chunk).toEqual(recoveredTerminal)
        order.push('notification')
      }),
      recoverTerminalPersistenceFailure: vi.fn(async () => {
        order.push('recovery')
        return { durableTerminal: true, notificationChunk: recoveredTerminal }
      }),
      releaseActiveRun: vi.fn(() => order.push('release')),
      performHandoff: vi.fn(() => order.push('handoff')),
      recordTerminalPersistenceIncident: vi.fn(),
      warn: vi.fn(),
    })

    const result = await controller.completeActiveTurn(activeRun(), {
      source: 'normal',
      terminalChunk: { type: 'finish', finishReason: 'stop' },
      requiredBookkeeping: async (terminalChunk) => {
        expect(terminalChunk).toEqual(recoveredTerminal)
        order.push('required')
      },
      bestEffortBookkeeping: async (terminalChunk) => {
        expect(terminalChunk).toEqual(recoveredTerminal)
        order.push('best-effort')
      },
      resolveHandoff: () => ({ kind: 'queue' }),
    })

    expect(result).toEqual({ durableTerminal: true, terminalChunk: recoveredTerminal })
    expect(order).toEqual(['recovery', 'required', 'release', 'notification', 'best-effort', 'handoff'])
  })

  it('blocks notification and handoff when required bookkeeping fails', async () => {
    const terminalChunk: UIMessageChunk = { type: 'abort', reason: 'user' }
    const publishTerminalNotification = vi.fn()
    const performHandoff = vi.fn()
    const releaseActiveRun = vi.fn()
    const controller = createActiveTurnCompletionController({
      persistTerminalChunk: vi.fn(async () => ({
        durableTerminal: true,
        notificationChunk: terminalChunk,
      })),
      publishTerminalNotification,
      recoverTerminalPersistenceFailure: vi.fn(),
      releaseActiveRun,
      performHandoff,
      recordTerminalPersistenceIncident: vi.fn(),
      warn: vi.fn(),
    })

    await expect(controller.completeActiveTurn(activeRun(), {
      source: 'cancel',
      terminalChunk,
      requiredBookkeeping: () => Promise.reject(new Error('required stage failed')),
    })).rejects.toThrow('required stage failed')
    expect(publishTerminalNotification).not.toHaveBeenCalled()
    expect(performHandoff).not.toHaveBeenCalled()
    expect(releaseActiveRun).toHaveBeenCalledTimes(1)
  })

  it('still notifies and handoffs when best-effort bookkeeping fails after durable terminal', async () => {
    const terminalChunk: UIMessageChunk = { type: 'finish', finishReason: 'stop' }
    const publishTerminalNotification = vi.fn()
    const performHandoff = vi.fn()
    const releaseActiveRun = vi.fn()
    const warn = vi.fn()
    const controller = createActiveTurnCompletionController({
      persistTerminalChunk: vi.fn(async () => ({
        durableTerminal: true,
        notificationChunk: terminalChunk,
      })),
      publishTerminalNotification,
      recoverTerminalPersistenceFailure: vi.fn(),
      releaseActiveRun,
      performHandoff,
      recordTerminalPersistenceIncident: vi.fn(),
      warn,
    })

    const result = await controller.completeActiveTurn(activeRun(), {
      source: 'normal',
      terminalChunk,
      bestEffortBookkeeping: () => Promise.reject(new Error('snapshot finalization failed')),
      resolveHandoff: () => ({ kind: 'queue' }),
    })

    expect(result).toEqual({ durableTerminal: true, terminalChunk })
    expect(warn).toHaveBeenCalledWith(
      'best-effort chat turn completion bookkeeping failed',
      expect.objectContaining({
        source: 'normal',
        sessionId: 'session-1',
        runId: 'run-1',
      }),
    )
    expect(publishTerminalNotification).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      terminalChunk,
    )
    expect(releaseActiveRun).toHaveBeenCalledTimes(1)
    expect(performHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      { kind: 'queue' },
    )
  })
})
