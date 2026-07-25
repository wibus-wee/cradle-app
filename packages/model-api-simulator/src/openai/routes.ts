import { Elysia } from 'elysia'

import type { SimulatorProtocolValidator } from '../core/protocol-validation'
import { observeRequest } from '../core/request-ledger'
import type { ScenarioController } from '../core/scenario-runtime'
import { createScheduledStream } from '../core/stream-scheduler'
import { authenticateOpenAi } from './auth'
import { openAiError } from './errors'
import { encodeOpenAiEvent } from './sse'
import { validateOpenAiStream } from './state-machine'

export function openAiRoutes(
  controller: ScenarioController,
  protocol: SimulatorProtocolValidator,
) {
  return new Elysia({ name: 'cradle.model-api-simulator.openai' })
    .post('/v1/responses', ({ request }) => handleOpenAiRequest(controller, protocol, request))
    .get('/v1/responses/:response_id', ({ request }) =>
      handleOpenAiRequest(controller, protocol, request))
    .delete('/v1/responses/:response_id', ({ request }) =>
      handleOpenAiRequest(controller, protocol, request))
    .post('/v1/responses/:response_id/cancel', ({ request }) =>
      handleOpenAiRequest(controller, protocol, request))
    .get('/v1/responses/:response_id/input_items', ({ request }) =>
      handleOpenAiRequest(controller, protocol, request))
    .post('/v1/responses/input_tokens', ({ request }) =>
      handleOpenAiRequest(controller, protocol, request))
    .post('/v1/responses/compact', ({ request }) =>
      handleOpenAiRequest(controller, protocol, request))
}

export async function handleOpenAiRequest(
  controller: ScenarioController,
  protocol: SimulatorProtocolValidator,
  request: Request,
): Promise<Response> {
  const authenticationError = authenticateOpenAi(request)
  if (authenticationError) { return authenticationError }
  try {
    const observed = await observeRequest(request)
    protocol.validateRequest('openai', request, observed)
    const exchange = controller.take('openai', observed)
    const headers = new Headers(exchange.response.headers)
    headers.set(
      'x-request-id',
      headers.get('x-request-id') ?? `req_simulator_${controller.requests().length}`,
    )
    if (exchange.response.kind === 'json') {
      protocol.validateJsonResponse('openai', request, exchange.response.body)
      headers.set('content-type', 'application/json')
      return Response.json(exchange.response.body, {
        status: exchange.response.status ?? 200,
        headers,
      })
    }
    protocol.validateStream('openai', request, exchange.response.steps)
    validateOpenAiStream(exchange.response.steps)
    headers.set('content-type', 'text/event-stream')
    headers.set('cache-control', 'no-cache')
    return new Response(
      createScheduledStream(controller, exchange.response.steps, step =>
        encodeOpenAiEvent(step.event)),
      { status: exchange.response.status ?? 200, headers },
    )
  }
 catch (error) {
    return openAiError(error instanceof Error ? error : new Error(String(error)))
  }
}
