import { Elysia } from 'elysia'

import type { SimulatorProtocolValidator } from '../core/protocol-validation'
import { observeRequest } from '../core/request-ledger'
import type { ScenarioController } from '../core/scenario-runtime'
import { createScheduledStream } from '../core/stream-scheduler'
import { authenticateAnthropic } from './auth'
import { anthropicError } from './errors'
import { encodeAnthropicEvent } from './sse'
import { validateAnthropicStream } from './state-machine'

export function anthropicRoutes(
  controller: ScenarioController,
  protocol: SimulatorProtocolValidator,
) {
  return new Elysia({ name: 'cradle.model-api-simulator.anthropic' })
    .post('/v1/messages', ({ request }) => handleAnthropicRequest(controller, protocol, request))
    .post('/v1/messages/count_tokens', ({ request }) =>
      handleAnthropicRequest(controller, protocol, request))
}

export async function handleAnthropicRequest(
  controller: ScenarioController,
  protocol: SimulatorProtocolValidator,
  request: Request,
): Promise<Response> {
  const authenticationError = authenticateAnthropic(request)
  if (authenticationError) { return authenticationError }
  try {
    const observed = await observeRequest(request)
    const operation = protocol.validateRequest('anthropic', request, observed)
    const exchange = controller.take('anthropic', observed)
    const headers = new Headers(exchange.response.headers)
    headers.set('request-id', headers.get('request-id') ?? `req_simulator_${controller.requests().length}`)
    if (exchange.response.kind === 'json') {
      protocol.validateJsonResponse(
        operation,
        request,
        exchange.response.status ?? 200,
        exchange.response.body,
      )
      headers.set('content-type', 'application/json')
      return Response.json(exchange.response.body, {
        status: exchange.response.status ?? 200,
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
