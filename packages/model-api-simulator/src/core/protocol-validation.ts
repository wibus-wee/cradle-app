import type { JsonValue, ObservedRequest, StreamStep } from '../contract'
import { isJsonArray, isJsonObject } from '../contract'
import type { ProtocolSchemaId } from './json-schema-registry'
import { JsonSchemaRegistry } from './json-schema-registry'

type Provider = 'anthropic' | 'openai'

export class SimulatorProtocolValidator {
  readonly #registry = new JsonSchemaRegistry()

  validateRequest(
    provider: Provider,
    request: Request,
    observed: Omit<ObservedRequest, 'index'>,
  ): void {
    const schemaId = requestSchema(provider, request)
    if (!schemaId) { return }
    if (observed.body === undefined) { throw new Error(`Request body is required for ${request.method}`) }
    this.#registry.validate(schemaId, observed.body)
  }

  validateJsonResponse(provider: Provider, request: Request, body: JsonValue): void {
    if (provider === 'anthropic' && new URL(request.url).pathname === '/v1/models') {
      if (!isJsonObject(body) || !body.data || !isJsonArray(body.data)) { throw new Error('Anthropic model list response requires a data array') }
      const schemaId = anthropicSchema(request, 'ModelInfo')
      for (const model of body.data) { this.#registry.validate(schemaId, model) }
      return
    }
    const schemaId = responseSchema(provider, request)
    if (schemaId) { this.#registry.validate(schemaId, body) }
  }

  validateStream(provider: Provider, request: Request, steps: readonly StreamStep[]): void {
    const schemaId: ProtocolSchemaId
      = provider === 'anthropic'
        ? anthropicSchema(request, 'RawMessageStreamEvent')
        : openAiSchema(request, 'ResponseStreamEvent')
    for (const step of steps) {
      if (step.kind !== 'event') { continue }
      if (provider === 'anthropic' && isJsonObject(step.event)) {
        if (step.event.type === 'ping') { continue }
        if (step.event.type === 'error') {
          this.#registry.validate('anthropic:draft-07:AnthropicErrorResponse', step.event)
          continue
        }
      }
      this.#registry.validate(schemaId, step.event)
    }
  }
}

function requestSchema(provider: Provider, request: Request): ProtocolSchemaId | undefined {
  const path = new URL(request.url).pathname
  if (provider === 'anthropic') {
    if (path === '/v1/messages') { return anthropicSchema(request, 'MessageCreateParams') }
    if (path === '/v1/messages/count_tokens') { return anthropicSchema(request, 'MessageCountTokensParams') }
    return undefined
  }
  if (path === '/v1/responses') { return openAiSchema(request, isBeta(request) ? 'BetaCreateResponse' : 'CreateResponse') }
  if (path === '/v1/responses/input_tokens') { return openAiSchema(request, 'TokenCountsBody') }
  if (path === '/v1/responses/compact') { return openAiSchema(request, 'CompactResponseMethodPublicBody') }
  return undefined
}

function responseSchema(provider: Provider, request: Request): ProtocolSchemaId | undefined {
  const path = new URL(request.url).pathname
  if (provider === 'anthropic') {
    if (path === '/v1/messages') { return anthropicSchema(request, 'Message') }
    if (path === '/v1/messages/count_tokens') { return anthropicSchema(request, 'MessageTokensCount') }
    if (path.startsWith('/v1/models/')) { return anthropicSchema(request, 'ModelInfo') }
    return undefined
  }
  if (path === '/v1/responses') { return openAiSchema(request, isBeta(request) ? 'BetaResponse' : 'Response') }
  if (path === '/v1/responses/input_tokens') { return openAiSchema(request, 'TokenCountsResource') }
  if (path === '/v1/responses/compact') { return openAiSchema(request, 'CompactResource') }
  if (/^\/v1\/responses\/[^/]+\/input_items$/.test(path)) { return openAiSchema(request, 'ResponseItemList') }
  if (/^\/v1\/responses\/[^/]+(?:\/cancel)?$/.test(path)) { return request.method === 'DELETE' ? undefined : openAiSchema(request, 'Response') }
  if (path === '/v1/models') { return openAiSchema(request, 'ListModelsResponse') }
  if (path.startsWith('/v1/models/')) { return openAiSchema(request, 'Model') }
  return undefined
}

function anthropicSchema(request: Request, name: string): ProtocolSchemaId {
  const prefix = isBeta(request) ? 'AnthropicBeta' : 'Anthropic'
  return `anthropic:draft-07:${prefix}${name}`
}

function openAiSchema(_request: Request, name: string): ProtocolSchemaId {
  return `openai:2020-12:${name}`
}

function isBeta(request: Request): boolean {
  const url = new URL(request.url)
  return url.searchParams.get('beta') === 'true' || request.headers.has('anthropic-beta')
}
