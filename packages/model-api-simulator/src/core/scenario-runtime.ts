import type {
  JsonValue,
  ObservedRequest,
  RequestMatch,
  SimulatorController,
  SimulatorExchange,
  SimulatorScenario,
} from '../contract'
import { isJsonArray, isJsonObject } from '../contract'

export class SimulatorScenarioError extends Error {
  override readonly name: string = 'SimulatorScenarioError'
}

export class UnexpectedRequestError extends SimulatorScenarioError {
  override readonly name = 'UnexpectedRequestError'

  constructor(readonly requestIndex: number, method: string, path: string) {
    super(`Unexpected request #${requestIndex}: ${method} ${path}`)
  }
}

export class ScenarioMismatchError extends SimulatorScenarioError {
  override readonly name = 'ScenarioMismatchError'

  constructor(
    readonly requestIndex: number,
    readonly scenarioLabel: string,
    readonly mismatchPath: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Scenario "${scenarioLabel}" request #${requestIndex} mismatch at ${mismatchPath}: expected ${expected}, got ${actual}`,
    )
  }
}

export class UnexhaustedScenarioError extends SimulatorScenarioError {
  override readonly name = 'UnexhaustedScenarioError'

  constructor(readonly pendingLabels: readonly string[]) {
    super(`Unconsumed exchanges: ${pendingLabels.join(', ')}`)
  }
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
  readonly settle: (error?: Error) => void
}

export interface ResettableSimulatorState {
  reset: () => void
}

export class ScenarioController implements SimulatorController {
  readonly #exchanges: QueuedExchange[] = []
  readonly #requests: ObservedRequest[] = []
  readonly #waiters: Array<{
    match: RequestMatch
    resolve: (request: ObservedRequest) => void
    reject: (error: Error) => void
  }> = []

  readonly #gates = new Map<string, Gate>()
  readonly #gateWaiters = new Map<string, Array<{
    resolve: () => void
    reject: (error: Error) => void
  }>>()

  readonly #streams = new Set<(reason: Error) => void>()
  #closed = false

  constructor(private readonly state?: ResettableSimulatorState) {}

  enqueue(scenario: SimulatorScenario): void {
    this.#assertOpen()
    this.#exchanges.push(
      ...scenario.exchanges.map(exchange => ({ provider: scenario.provider, exchange })),
    )
  }

  waitForRequest(match: RequestMatch): Promise<ObservedRequest> {
    const request = this.#requests.find(candidate => matches(candidate, match) === undefined)
    if (request) { return Promise.resolve(request) }
    return new Promise((resolve, reject) => {
      this.#waiters.push({ match, resolve, reject })
    })
  }

  release(gate: string): void {
    const pending = this.#gates.get(gate)
    if (!pending) { throw new UnknownGateError(`Unknown or already settled gate "${gate}"`) }
    pending.settle()
  }

  waitForGate(gate: string): Promise<void> {
    if (this.#gates.has(gate)) { return Promise.resolve() }
    return new Promise<void>((resolve, reject) => {
      const waiters = this.#gateWaiters.get(gate) ?? []
      waiters.push({ resolve, reject })
      this.#gateWaiters.set(gate, waiters)
    })
  }

  requests(): readonly ObservedRequest[] {
    return [...this.#requests]
  }

  assertExhausted(): void {
    if (this.#exchanges.length > 0) {
      throw new UnexhaustedScenarioError(this.#exchanges.map(item => item.exchange.label))
    }
    if (this.#gates.size > 0) {
      throw new SimulatorScenarioError(`Unreleased gates: ${[...this.#gates.keys()].join(', ')}`)
    }
    if (this.#streams.size > 0) {
      throw new SimulatorScenarioError(`${this.#streams.size} stream(s) remain open`)
    }
  }

  reset(): void {
    if (this.#streams.size > 0) {
      throw new SimulatorScenarioError('Cannot reset while a stream is open')
    }
    this.state?.reset()
    this.#exchanges.length = 0
    this.#requests.length = 0
    const reason = new SimulatorScenarioError('Simulator reset')
    this.#settleRequestWaiters(reason)
    this.#settleAllGates(reason)
    this.#settleGateWaiters(reason)
  }

  /** Records an observed request without consuming a queued exchange. */
  record(request: Omit<ObservedRequest, 'index'>): ObservedRequest {
    this.#assertOpen()
    const observed: ObservedRequest = {
      ...request,
      query: request.query ?? {},
      index: this.#requests.length,
    }
    this.#requests.push(observed)
    for (const waiter of this.#waiters.splice(0)) {
      if (matches(observed, waiter.match) === undefined) { waiter.resolve(observed) }
      else { this.#waiters.push(waiter) }
    }
    return observed
  }

  /**
   * Peek whether the next enqueued exchange would accept this request.
   * Used by autoRespond to absorb probe noise without consuming conversation turns.
   */
  nextMatches(
    provider: SimulatorScenario['provider'],
    request: Omit<ObservedRequest, 'index'>,
  ): boolean {
    const queued = this.#exchanges[0]
    if (!queued || queued.provider !== provider) {
      return false
    }
    const provisional: ObservedRequest = {
      ...request,
      query: request.query ?? {},
      index: this.#requests.length,
    }
    if (matches(provisional, queued.exchange.request)) {
      return false
    }
    for (const [name, expected] of Object.entries(queued.exchange.expectedHeaders ?? {})) {
      if (provisional.headers[name.toLowerCase()] !== expected) {
        return false
      }
    }
    return true
  }

  take(
    provider: SimulatorScenario['provider'],
    request: Omit<ObservedRequest, 'index'>,
  ): SimulatorExchange {
    const observed = this.record(request)

    const queued = this.#exchanges[0]
    if (!queued) {
      throw new UnexpectedRequestError(observed.index, observed.method, observed.path)
    }
    const mismatch = queued.provider === provider
      ? matches(observed, queued.exchange.request)
      : {
          path: '/provider',
          expected: queued.provider,
          actual: provider,
        }
    if (mismatch) {
      throw new ScenarioMismatchError(
        observed.index,
        queued.exchange.label,
        mismatch.path,
        mismatch.expected,
        mismatch.actual,
      )
    }
    for (const [name, expected] of Object.entries(queued.exchange.expectedHeaders ?? {})) {
      const actual = observed.headers[name.toLowerCase()]
      if (actual !== expected) {
        throw new ScenarioMismatchError(
          observed.index,
          queued.exchange.label,
          `/headers/${escapePointer(name.toLowerCase())}`,
          JSON.stringify(expected),
          JSON.stringify(actual),
        )
      }
    }
    this.#exchanges.shift()
    return queued.exchange
  }

  waitAtGate(name: string, signal?: AbortSignal): Promise<void> {
    if (this.#gates.has(name)) {
      throw new DuplicateGateError(`Duplicate active gate "${name}"`)
    }
    let resolvePromise: (() => void) | undefined
    let rejectPromise: ((error: Error) => void) | undefined
    let settled = false
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const settle = (error?: Error): void => {
      if (settled) { return }
      settled = true
      this.#gates.delete(name)
      signal?.removeEventListener('abort', onAbort)
      if (error) { rejectPromise!(error) }
      else { resolvePromise!() }
    }
    const onAbort = (): void =>
      settle(new SimulatorScenarioError(`Gate "${name}" cancelled by stream owner`))
    signal?.addEventListener('abort', onAbort, { once: true })
    this.#gates.set(name, { promise, settle })
    for (const waiter of this.#gateWaiters.get(name) ?? []) { waiter.resolve() }
    this.#gateWaiters.delete(name)
    if (signal?.aborted) { onAbort() }
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
    this.state?.reset()
    this.#settleAllGates(reason)
    this.#settleGateWaiters(reason)
    this.#exchanges.length = 0
    this.#settleRequestWaiters(reason)
  }

  get pendingExchangeCount(): number {
    return this.#exchanges.length
  }

  #settleAllGates(reason: Error): void {
    for (const gate of [...this.#gates.values()]) { gate.settle(reason) }
  }

  #settleGateWaiters(reason: Error): void {
    for (const waiters of this.#gateWaiters.values()) {
      for (const waiter of waiters) { waiter.reject(reason) }
    }
    this.#gateWaiters.clear()
  }

  #settleRequestWaiters(reason: Error): void {
    for (const waiter of this.#waiters) { waiter.reject(reason) }
    this.#waiters.length = 0
  }

  #assertOpen(): void {
    if (this.#closed) { throw new SimulatorScenarioError('Simulator is closed') }
  }
}

interface Mismatch {
  readonly path: string
  readonly expected: string
  readonly actual: string
}

function matches(request: ObservedRequest, match: RequestMatch): Mismatch | undefined {
  if (request.method.toUpperCase() !== match.method.toUpperCase()) {
    return { path: '/method', expected: match.method.toUpperCase(), actual: request.method.toUpperCase() }
  }
  if (request.path !== match.path) {
    return { path: '/path', expected: match.path, actual: request.path }
  }
  const queryMismatch = match.query === undefined
    ? undefined
    : compareJson(request.query ?? {}, match.query as JsonValue, '/query')
  if (queryMismatch) { return queryMismatch }
  if (match.body !== undefined) {
    const bodyMismatch = compareJson(request.body, match.body, '/body')
    if (bodyMismatch) { return bodyMismatch }
  }
  for (const [pointer, expected] of Object.entries(match.bodyFields ?? {})) {
    const actual = resolvePointer(request.body, pointer)
    const fieldMismatch = compareJson(actual, expected, `/body${pointer}`)
    if (fieldMismatch) { return fieldMismatch }
  }
  const includes = match.bodyTextIncludes === undefined
    ? []
    : Array.isArray(match.bodyTextIncludes)
      ? match.bodyTextIncludes
      : [match.bodyTextIncludes]
  const excludes = match.bodyTextExcludes === undefined
    ? []
    : Array.isArray(match.bodyTextExcludes)
      ? match.bodyTextExcludes
      : [match.bodyTextExcludes]
  if (includes.length > 0 || excludes.length > 0) {
    const bodyText = request.body === undefined ? '' : JSON.stringify(request.body)
    for (const needle of includes) {
      if (!bodyText.includes(needle)) {
        return {
          path: '/bodyTextIncludes',
          expected: needle,
          actual: bodyText.length > 200 ? `${bodyText.slice(0, 200)}…` : bodyText,
        }
      }
    }
    for (const needle of excludes) {
      if (bodyText.includes(needle)) {
        return {
          path: '/bodyTextExcludes',
          expected: `not containing ${needle}`,
          actual: `contains ${needle}`,
        }
      }
    }
  }
  return undefined
}

function compareJson(actual: JsonValue | undefined, expected: JsonValue, path: string): Mismatch | undefined {
  if (Object.is(actual, expected)) { return undefined }
  if (isJsonArray(expected)) {
    if (actual === undefined || !isJsonArray(actual)) { return mismatch(path, expected, actual) }
    if (actual.length !== expected.length) { return mismatch(`${path}/length`, expected.length, actual.length) }
    for (let index = 0; index < expected.length; index += 1) {
      const child = compareJson(actual[index], expected[index]!, `${path}/${index}`)
      if (child) { return child }
    }
    return undefined
  }
  if (isJsonObject(expected)) {
    if (actual === undefined || !isJsonObject(actual)) { return mismatch(path, expected, actual) }
    const expectedKeys = Object.keys(expected).sort()
    const actualKeys = Object.keys(actual).sort()
    if (expectedKeys.join('\0') !== actualKeys.join('\0')) {
      return mismatch(`${path}/keys`, expectedKeys, actualKeys)
    }
    for (const key of expectedKeys) {
      const child = compareJson(actual[key], expected[key]!, `${path}/${escapePointer(key)}`)
      if (child) { return child }
    }
    return undefined
  }
  return mismatch(path, expected, actual)
}

function resolvePointer(value: JsonValue | undefined, pointer: string): JsonValue | undefined {
  if (pointer === '') { return value }
  if (!pointer.startsWith('/')) { throw new SimulatorScenarioError(`JSON pointer must start with "/": ${pointer}`) }
  let current = value
  for (const rawPart of pointer.slice(1).split('/')) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~')
    if (current === undefined) { return undefined }
    if (isJsonArray(current)) {
      const index = Number(part)
      current = Number.isInteger(index) ? current[index] : undefined
    }
    else if (isJsonObject(current)) { current = current[part] }
    else { return undefined }
  }
  return current
}

function mismatch(path: string, expected: unknown, actual: unknown): Mismatch {
  return {
    path,
    expected: JSON.stringify(expected),
    actual: JSON.stringify(actual),
  }
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
