import type {
  ModelApiSimulator,
  ObservedRequest,
  RequestMatch,
  SimulatorController,
  SimulatorScenario,
} from '@cradle/model-api-simulator'
import { startModelApiSimulator } from '@cradle/model-api-simulator'

export type E2ESimulator = {
  anthropicBaseUrl: string
  openaiBaseUrl: string
  controller: SimulatorController
  close: () => Promise<void>
  reset: () => void
  enqueue: (scenario: SimulatorScenario) => void
  requests: () => readonly ObservedRequest[]
  waitForRequest: (match: RequestMatch) => Promise<ObservedRequest>
  waitForGate: (gate: string) => Promise<void>
  release: (gate: string) => void
  assertExhausted: () => void
}

/**
 * Start a loopback model-api-simulator for E2E.
 * autoRespond absorbs probe traffic (models, count_tokens, title gen) without
 * consuming queued conversation exchanges.
 */
export async function startE2ESimulator(): Promise<E2ESimulator> {
  const simulator: ModelApiSimulator = await startModelApiSimulator({
    autoRespond: true,
    strictRequestValidation: false,
  })

  return {
    anthropicBaseUrl: simulator.anthropicBaseUrl,
    openaiBaseUrl: simulator.openaiBaseUrl,
    controller: simulator.controller,
    close: () => simulator.close(),
    reset: () => simulator.controller.reset(),
    enqueue: scenario => simulator.controller.enqueue(scenario),
    requests: () => simulator.controller.requests(),
    waitForRequest: match => simulator.controller.waitForRequest(match),
    waitForGate: gate => simulator.controller.waitForGate(gate),
    release: gate => simulator.controller.release(gate),
    assertExhausted: () => simulator.controller.assertExhausted(),
  }
}
