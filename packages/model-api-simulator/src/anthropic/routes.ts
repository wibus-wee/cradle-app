import { Elysia } from 'elysia'

import type { AutoRespondMode } from '../contract'
import { shouldAutoRespondForController } from '../core/auto-respond-policy'
import type { SimulatorProtocolValidator } from '../core/protocol-validation'
import { observeRequest } from '../core/request-ledger'
import type { ScenarioController } from '../core/scenario-runtime'
import { createScheduledStream } from '../core/stream-scheduler'
import { authenticateAnthropic } from './auth'
import { autoAnthropicResponse } from './auto-respond'
import { anthropicError } from './errors'
import { encodeAnthropicEvent } from './sse'
import { validateAnthropicStream } from './state-machine'

export function anthropicRoutes(
  controller: ScenarioController,
  protocol: SimulatorProtocolValidator,
  autoRespond: AutoRespondMode = false,
) {
  return new Elysia({ name: 'cradle.model-api-simulator.anthropic' })
    .post('/v1/messages', ({ request }) =>
      handleAnthropicRequest(controller, protocol, request, autoRespond))
    .post('/v1/messages/count_tokens', ({ request }) =>
      handleAnthropicRequest(controller, protocol, request, autoRespond))
}

export async function handleAnthropicRequest(
  controller: ScenarioController,
  protocol: SimulatorProtocolValidator,
  request: Request,
  autoRespond: AutoRespondMode = false,
): Promise<Response> {
  const authenticationError = authenticateAnthropic(request)
  if (authenticationError) { return authenticationError }
  try {
    const observed = await observeRequest(request)
    const operation = protocol.validateRequest('anthropic', request, observed)
    if (
      shouldAutoRespondForController(autoRespond, 'anthropic', observed, controller)
      && !controller.nextMatches('anthropic', observed)
    ) {
      controller.record(observed)
      return autoAnthropicResponse(controller, observed)
    }
    const exchange = controller.take('anthropic', observed)
    const headers = new Headers(exchange.response.headers)
    headers.set('request-id', headers.get('request-id') ?? `req_simulator_${controller.requests().length}`)
    if (exchange.response.kind === 'json') {
      const status = exchange.response.status ?? 200
      // Error payloads are AnthropicErrorResponse, not Message — do not validate
      // them against the success response schema (that remaps into a 400 and hides
      // the scripted failure message from Claude Agent).
      if (status < 400) {
        protocol.validateJsonResponse(
          operation,
          request,
          status,
          exchange.response.body,
        )
      }
      headers.set('content-type', 'application/json')
      return Response.json(exchange.response.body, {
        status,
        headers,
      })
    }
    protocol.validateStream(operation, exchange.response.steps)
    validateAnthropicStream(exchange.response.steps)
    headers.set('content-type', 'text/event-stream')
    headers.set('cache-control', 'no-cache')
    return new Response(
      createScheduledStream(controller, exchange.response.steps, step =>
        encodeAnthropicEvent(step.event)),
      { status: exchange.response.status ?? 200, headers },
    )
  }
 catch (error) {
    return anthropicError(error instanceof Error ? error : new Error(String(error)))
  }
}
