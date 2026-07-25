import { Elysia } from 'elysia'

import { anthropicRoutes, handleAnthropicRequest } from './anthropic/routes'
import { SimulatorProtocolValidator } from './core/protocol-validation'
import type { ScenarioController } from './core/scenario-runtime'
import { handleOpenAiRequest, openAiRoutes } from './openai/routes'

export function createSimulatorApp(_controller: ScenarioController) {
  const protocol = new SimulatorProtocolValidator()
  return new Elysia({
    name: 'cradle.model-api-simulator',
    normalize: 'typebox',
  })
    .use(anthropicRoutes(_controller, protocol))
    .use(openAiRoutes(_controller, protocol))
    .get('/v1/models', ({ request }) =>
      isAnthropicRequest(request)
        ? handleAnthropicRequest(_controller, protocol, request)
        : handleOpenAiRequest(_controller, protocol, request))
    .get('/v1/models/:model', ({ request }) =>
      isAnthropicRequest(request)
        ? handleAnthropicRequest(_controller, protocol, request)
        : handleOpenAiRequest(_controller, protocol, request))
}

function isAnthropicRequest(request: Request): boolean {
  return Boolean(request.headers.get('anthropic-version') || request.headers.get('x-api-key'))
}
