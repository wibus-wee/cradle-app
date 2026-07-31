import type { AutoRespondMode, ObservedRequest } from '../contract'
import type { ScenarioController } from './scenario-runtime'

/**
 * Decide whether an unmatched request may be auto-answered.
 *
 * `probes-only` policy (recommended for E2E):
 * - Always auto token-count / models / light OpenAI resource reads
 * - While conversation exchanges remain queued, also auto unmatched
 *   conversation creates so Claude Agent / Codex probe noise cannot steal FIFO
 * - When the queue is empty, unmatched conversation creates fail — this catches
 *   unexpected extra turns that would previously silent-auto and hide bugs
 */
export function shouldAutoRespond(
  mode: AutoRespondMode,
  provider: 'anthropic' | 'openai',
  observed: Pick<ObservedRequest, 'method' | 'path'>,
  pendingExchangeCount: number,
): boolean {
  if (mode === false) {
    return false
  }
  if (mode === true) {
    return true
  }
  // probes-only
  if (isProbePath(provider, observed)) {
    return true
  }
  return pendingExchangeCount > 0
}

export function shouldAutoRespondForController(
  mode: AutoRespondMode,
  provider: 'anthropic' | 'openai',
  observed: Pick<ObservedRequest, 'method' | 'path'>,
  controller: Pick<ScenarioController, 'pendingExchangeCount'>,
): boolean {
  return shouldAutoRespond(mode, provider, observed, controller.pendingExchangeCount)
}

function isProbePath(
  provider: 'anthropic' | 'openai',
  observed: Pick<ObservedRequest, 'method' | 'path'>,
): boolean {
  const method = observed.method.toUpperCase()
  const { path } = observed
  if (provider === 'anthropic') {
    if (path === '/v1/messages/count_tokens') {
      return true
    }
    return method === 'GET' && path.startsWith('/v1/models')
  }
  if (method === 'GET' && path.startsWith('/v1/models')) {
    return true
  }
  if (method === 'POST' && path === '/v1/responses/input_tokens') {
    return true
  }
  return method === 'GET' && path.startsWith('/v1/responses/')
}
