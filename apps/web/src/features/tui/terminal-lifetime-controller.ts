import {
  deleteTerminalSessionsBySessionId,
  deleteTerminalSessionsShellByPtyId,
} from '~/api-gen/sdk.gen'

export type TerminalAdapterKind = 'cli-tui' | 'bottom-panel' | 'browser-tui'

export type TerminalLifetimePhase = 'registered' | 'attached' | 'parked' | 'stopping' | 'stopped' | 'exited'

interface TerminalLifetimeRecord {
  terminalId: string
  adapterKind: TerminalAdapterKind
  ownerId: string
  phase: TerminalLifetimePhase
  stopPromise: Promise<void> | null
}

interface TerminalLifetimeControllerOptions {
  stopShell?: (ptyId: string) => Promise<void>
  stopCliTui?: (sessionId: string) => Promise<void>
  disposeCliTuiRuntime?: (sessionId: string) => void
}

function defaultStopShell(ptyId: string): Promise<void> {
  return deleteTerminalSessionsShellByPtyId({ path: { ptyId } }).then(() => undefined)
}

function defaultStopCliTui(sessionId: string): Promise<void> {
  return deleteTerminalSessionsBySessionId({ path: { sessionId } }).then(() => undefined)
}

export class TerminalLifetimeController {
  private readonly records = new Map<string, TerminalLifetimeRecord>()
  private readonly stopShell: (ptyId: string) => Promise<void>
  private readonly stopCliTui: (sessionId: string) => Promise<void>
  private readonly disposeCliTuiRuntime: (sessionId: string) => void

  constructor(options: TerminalLifetimeControllerOptions = {}) {
    this.stopShell = options.stopShell ?? defaultStopShell
    this.stopCliTui = options.stopCliTui ?? defaultStopCliTui
    this.disposeCliTuiRuntime = options.disposeCliTuiRuntime ?? (() => {})
  }

  register(input: {
    terminalId: string
    adapterKind: TerminalAdapterKind
    ownerId: string
  }): void {
    const existing = this.records.get(input.terminalId)
    if (existing && existing.phase !== 'stopped' && existing.phase !== 'exited') {
      existing.adapterKind = input.adapterKind
      existing.ownerId = input.ownerId
      return
    }

    this.records.set(input.terminalId, {
      terminalId: input.terminalId,
      adapterKind: input.adapterKind,
      ownerId: input.ownerId,
      phase: 'registered',
      stopPromise: null,
    })
  }

  attach(terminalId: string): void {
    const record = this.records.get(terminalId)
    if (!record || record.phase === 'stopping' || record.phase === 'stopped') {
      return
    }
    record.phase = 'attached'
  }

  park(terminalId: string): void {
    const record = this.records.get(terminalId)
    if (!record || record.phase === 'stopping' || record.phase === 'stopped' || record.phase === 'exited') {
      return
    }
    record.phase = 'parked'
  }

  recordExited(terminalId: string): void {
    const record = this.records.get(terminalId)
    if (!record) {
      return
    }
    record.phase = 'exited'
    record.stopPromise = null
  }

  async stop(terminalId: string): Promise<void> {
    const record = this.records.get(terminalId)
    if (!record) {
      return
    }
    if (record.phase === 'stopped' || record.phase === 'exited') {
      return
    }
    if (record.stopPromise) {
      return record.stopPromise
    }

    record.phase = 'stopping'
    const stopPromise = this.performStop(record)
      .then(() => {
        const current = this.records.get(terminalId)
        if (!current || current.stopPromise !== stopPromise) {
          return
        }
        current.phase = 'stopped'
        current.stopPromise = null
      })
      .catch((error) => {
        const current = this.records.get(terminalId)
        if (current && current.stopPromise === stopPromise) {
          // Keep a retryable phase; do not pretend success.
          current.phase = current.phase === 'stopping' ? 'attached' : current.phase
          current.stopPromise = null
        }
        throw error
      })

    record.stopPromise = stopPromise
    return stopPromise
  }

  async disposeOwner(ownerId: string): Promise<void> {
    const terminalIds = Array.from(this.records.values())
      .filter(record => record.ownerId === ownerId)
      .map(record => record.terminalId)

    await Promise.allSettled(terminalIds.map(terminalId => this.stop(terminalId)))
  }

  getPhase(terminalId: string): TerminalLifetimePhase | null {
    return this.records.get(terminalId)?.phase ?? null
  }

  /** Test helper / diagnostics */
  snapshot(): TerminalLifetimeRecord[] {
    return Array.from(this.records.values()).map(record => ({ ...record }))
  }

  private async performStop(record: TerminalLifetimeRecord): Promise<void> {
    if (record.adapterKind === 'cli-tui') {
      this.disposeCliTuiRuntime(record.terminalId)
      await this.stopCliTui(record.terminalId)
      return
    }

    await this.stopShell(record.terminalId)
  }
}

let sharedController: TerminalLifetimeController | null = null

export function getTerminalLifetimeController(): TerminalLifetimeController {
  if (!sharedController) {
    sharedController = new TerminalLifetimeController({
      disposeCliTuiRuntime: (sessionId) => {
        void import('./tui-runtime-registry').then(({ tuiRuntimeRegistry }) => {
          tuiRuntimeRegistry.dispose(sessionId)
        })
      },
    })
  }
  return sharedController
}

/** Test-only reset to avoid cross-test leakage. */
export function __resetTerminalLifetimeControllerForTests(): void {
  sharedController = null
}
