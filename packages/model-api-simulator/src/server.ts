import { Elysia } from 'elysia'

import { anthropicRoutes, handleAnthropicRequest } from './anthropic/routes'
import { SimulatorProtocolValidator } from './core/protocol-validation'
import { ScenarioController } from './core/scenario-runtime'
import { OpenAiResourceStore } from './openai/resource-store'
import { handleOpenAiRequest, openAiRoutes } from './openai/routes'

export interface SimulatorRuntime {
  readonly controller: ScenarioController
  readonly openAiResources: OpenAiResourceStore
}

export function createSimulatorRuntime(): SimulatorRuntime {
  const openAiResources = new OpenAiResourceStore()
  return {
    controller: new ScenarioController(openAiResources),
    openAiResources,
  }
}

export function createSimulatorApp(runtime: SimulatorRuntime) {
  const { controller, openAiResources } = runtime
  const protocol = new SimulatorProtocolValidator()
  return new Elysia({
    name: 'cradle.model-api-simulator',
    normalize: 'typebox',
  })
    .use(anthropicRoutes(controller, protocol))
    .use(openAiRoutes(controller, protocol, openAiResources))
    .get('/v1/models', ({ request }) =>
      isAnthropicRequest(request)
        ? handleAnthropicRequest(controller, protocol, request)
        : handleOpenAiRequest(controller, protocol, openAiResources, request))
    .get('/v1/models/:model', ({ request }) =>
      isAnthropicRequest(request)
        ? handleAnthropicRequest(controller, protocol, request)
        : handleOpenAiRequest(controller, protocol, openAiResources, request))
}

function isAnthropicRequest(request: Request): boolean {
  return Boolean(request.headers.get('anthropic-version') || request.headers.get('x-api-key'))
}
