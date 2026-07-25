import type {
  ObservedRequest,
  RequestMatch,
  SimulatorController,
  SimulatorExchange,
  SimulatorScenario,
} from '../contract'

export class SimulatorScenarioError extends Error {
  override readonly name: string = 'SimulatorScenarioError'
}

export class DuplicateGateError extends SimulatorScenarioError {
  override readonly name = 'DuplicateGateError'
}

export class UnknownGateError extends SimulatorScenarioError {
  override readonly name = 'UnknownGateError'
}

interface QueuedExchange {
  readonly provider: SimulatorScenario['provider']
  readonly exchange: SimulatorExchange
}

interface Gate {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

export class ScenarioController implements SimulatorController {
  readonly #exchanges: QueuedExchange[] = []
  readonly #requests: ObservedRequest[] = []
  readonly #waiters: Array<{
    match: RequestMatch
    resolve: (request: ObservedRequest) => void
  }> = []

  readonly #gates = new Map<string, Gate>()
  readonly #streams = new Set<(reason: Error) => void>()
  #closed = false

  enqueue(scenario: SimulatorScenario): void {
    this.#assertOpen()
    this.#exchanges.push(
      ...scenario.exchanges.map(exchange => ({ provider: scenario.provider, exchange })),
    )
  }

  waitForRequest(match: RequestMatch): Promise<ObservedRequest> {
    const request = this.#requests.find(candidate => matches(candidate, match))
    if (request) { return Promise.resolve(request) }

    return new Promise((resolve) => {
      this.#waiters.push({ match, resolve })
    })
  }

  release(gate: string): void {
    const pending = this.#gates.get(gate)
    if (!pending) { throw new UnknownGateError(`Unknown or already released gate "${gate}"`) }
    this.#gates.delete(gate)
    pending.resolve()
  }

  requests(): readonly ObservedRequest[] {
    return [...this.#requests]
  }

  assertExhausted(): void {
    if (this.#exchanges.length > 0) { throw new SimulatorScenarioError(`${this.#exchanges.length} exchange(s) remain`) }
    if (this.#gates.size > 0) { throw new SimulatorScenarioError(`Unreleased gates: ${[...this.#gates.keys()].join(', ')}`) }
    if (this.#streams.size > 0) { throw new SimulatorScenarioError(`${this.#streams.size} stream(s) remain open`) }
  }

  reset(): void {
    if (this.#streams.size > 0) { throw new SimulatorScenarioError('Cannot reset while a stream is open') }
    this.#exchanges.length = 0
    this.#requests.length = 0
    this.#waiters.length = 0
    this.#gates.clear()
  }

  take(
    provider: SimulatorScenario['provider'],
    request: Omit<ObservedRequest, 'index'>,
  ): SimulatorExchange {
    this.#assertOpen()
    const observed: ObservedRequest = { ...request, index: this.#requests.length }
    this.#requests.push(observed)
    for (const waiter of this.#waiters.splice(0)) {
      if (matches(observed, waiter.match)) { waiter.resolve(observed) }
      else { this.#waiters.push(waiter) }
    }

    const queued = this.#exchanges.shift()
    if (!queued) {
 throw new SimulatorScenarioError(
        `Unexpected request #${observed.index}: ${observed.method} ${observed.path}`,
      )
}
    const { exchange } = queued
    if (queued.provider !== provider || !matches(observed, exchange.request)) {
 throw new SimulatorScenarioError(
        `Scenario "${exchange.label}" expected ${queued.provider} ${exchange.request.method} ${exchange.request.path}, got ${provider} ${observed.method} ${observed.path}`,
      )
}
    for (const [name, expected] of Object.entries(exchange.expectedHeaders ?? {})) {
      if (observed.headers[name.toLowerCase()] !== expected) {
 throw new SimulatorScenarioError(
          `Scenario "${exchange.label}" expected header ${name}: ${expected}`,
        )
}
    }
    return exchange
  }

  waitAtGate(name: string): Promise<void> {
    if (this.#gates.has(name)) { throw new DuplicateGateError(`Duplicate active gate "${name}"`) }
    let release: (() => void) | undefined
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#gates.set(name, { promise, resolve: release! })
    return promise
  }

  trackStream(cancel: (reason: Error) => void): () => void {
    this.#streams.add(cancel)
    return () => this.#streams.delete(cancel)
  }

  close(): void {
    if (this.#closed) { return }
    this.#closed = true
    const reason = new SimulatorScenarioError('Simulator closed')
    for (const cancel of [...this.#streams]) { cancel(reason) }
    this.#streams.clear()
    this.#gates.clear()
    this.#exchanges.length = 0
    this.#waiters.length = 0
  }

  get pendingExchangeCount(): number {
    return this.#exchanges.length
  }

  #assertOpen(): void {
    if (this.#closed) { throw new SimulatorScenarioError('Simulator is closed') }
  }
}

function matches(request: ObservedRequest, match: RequestMatch): boolean {
  return (
    request.method.toUpperCase() === match.method.toUpperCase()
    && request.path === match.path
    && (match.body === undefined || JSON.stringify(request.body) === JSON.stringify(match.body))
  )
}
