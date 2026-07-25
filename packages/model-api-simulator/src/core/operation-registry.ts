import scope from '../../protocol/core-scope.json'
import openAiDocument from '../../protocol/openai/openapi.json'
import type { JsonValue, ObservedRequest } from '../contract'
import { isJsonArray, isJsonObject } from '../contract'
import type { ProtocolSchemaId } from './json-schema-registry'
import { JsonSchemaRegistry } from './json-schema-registry'

export type Provider = 'anthropic' | 'openai'

export interface MatchedOperation {
  readonly provider: Provider
  readonly id: string
  readonly pathParameters: Readonly<Record<string, string>>
  readonly beta: boolean
}

interface OperationDefinition {
  readonly provider: Provider
  readonly id: string
  readonly method: string
  readonly pathTemplate: string
  readonly beta?: boolean
  readonly requestSchema?: ProtocolSchemaId
  readonly responseSchema?: ProtocolSchemaId
}

const anthropicOperations: readonly OperationDefinition[] = [
  {
    provider: 'anthropic',
    id: 'messages.create',
    method: 'POST',
    pathTemplate: '/v1/messages',
    requestSchema: 'anthropic:draft-07:AnthropicMessageCreateParams',
    responseSchema: 'anthropic:draft-07:AnthropicMessage',
  },
  {
    provider: 'anthropic',
    id: 'messages.count_tokens',
    method: 'POST',
    pathTemplate: '/v1/messages/count_tokens',
    requestSchema: 'anthropic:draft-07:AnthropicMessageCountTokensParams',
    responseSchema: 'anthropic:draft-07:AnthropicMessageTokensCount',
  },
  {
    provider: 'anthropic',
    id: 'models.list',
    method: 'GET',
    pathTemplate: '/v1/models',
  },
  {
    provider: 'anthropic',
    id: 'models.retrieve',
    method: 'GET',
    pathTemplate: '/v1/models/{model}',
    responseSchema: 'anthropic:draft-07:AnthropicModelInfo',
  },
]

const openAiPathEntries = Object.entries(openAiDocument.paths)
const openAiOperations: readonly OperationDefinition[] = openAiPathEntries.flatMap(
  ([snapshotPath, pathItem]) =>
    (['get', 'post', 'delete'] as const).flatMap((method) => {
      const operation = (pathItem as Record<string, { operationId?: string } | undefined>)[method]
      if (!operation || !scope.openai.operations.includes(operation.operationId as never)) {
        return []
      }
      const beta = snapshotPath.endsWith('?beta=true')
      return [{
        provider: 'openai' as const,
        id: operation.operationId!,
        method: method.toUpperCase(),
        pathTemplate: `/v1${snapshotPath.replace('?beta=true', '')}`,
        ...(beta ? { beta: true } : {}),
      }]
    }),
)

const operations: readonly OperationDefinition[] = [
  ...anthropicOperations,
  ...openAiOperations,
]

export class OperationRegistry {
  readonly #schemas = new JsonSchemaRegistry()

  match(provider: Provider, request: Request): MatchedOperation {
    const url = new URL(request.url)
    const candidates = operations.filter(operation =>
      operation.provider === provider
      && operation.method === request.method.toUpperCase()
      && Boolean(operation.beta) === (provider === 'openai' && url.searchParams.get('beta') === 'true'))
    for (const operation of candidates) {
      const parameters = matchPath(operation.pathTemplate, url.pathname)
      if (!parameters) { continue }
      return {
        provider,
        id: operation.id,
        pathParameters: parameters,
        beta: isBeta(provider, request),
      }
    }
    throw new Error(`Unsupported ${provider} operation: ${request.method} ${url.pathname}${url.search}`)
  }

  validateRequest(
    operation: MatchedOperation,
    request: Request,
    observed: Omit<ObservedRequest, 'index'>,
  ): void {
    const definition = this.#definition(operation)
    if (operation.provider === 'anthropic') {
      this.#validateAnthropicRequest(definition, operation.beta, request, observed)
      return
    }
    const source = openAiOperation(operation.id)
    validateParameters(
      this.#schemas,
      source.parameters,
      request,
      operation.pathParameters,
      operation.beta ? new Set(['beta']) : new Set(),
    )
    const bodySchema = jsonSchema(source.requestBody)
    if (bodySchema) {
      if (observed.body === undefined) { throw new Error(`Request body is required for ${operation.id}`) }
      this.#schemas.validateOpenAiSchema(bodySchema, observed.body, `${operation.id}:request`)
    }
  }

  validateResponse(
    operation: MatchedOperation,
    request: Request,
    status: number,
    body: JsonValue,
  ): void {
    const definition = this.#definition(operation)
    if (operation.provider === 'anthropic') {
      if (operation.id === 'models.list') {
        if (!isJsonObject(body)) {
          throw new Error('Anthropic model list response requires a data array')
        }
        const models = body.data
        if (models === undefined || !isJsonArray(models)) {
          throw new Error('Anthropic model list response requires a data array')
        }
        const schemaId = anthropicVariantSchema(
          'anthropic:draft-07:AnthropicModelInfo',
          operation.beta,
        )
        for (const model of models) { this.#schemas.validate(schemaId, model) }
        return
      }
      if (definition.responseSchema) {
        this.#schemas.validate(
          anthropicVariantSchema(definition.responseSchema, operation.beta),
          body,
        )
      }
      return
    }
    const source = openAiOperation(operation.id)
    const response = (source.responses as Record<string, unknown>)[String(status)]
    const schema = jsonSchema(response)
    if (schema) { this.#schemas.validateOpenAiSchema(schema, body, `${operation.id}:response:${status}`) }
  }

  #definition(operation: MatchedOperation): OperationDefinition {
    const definition = operations.find(candidate =>
      candidate.provider === operation.provider && candidate.id === operation.id)
    if (!definition) { throw new Error(`Unknown operation identity ${operation.provider}:${operation.id}`) }
    return definition
  }

  #validateAnthropicRequest(
    definition: OperationDefinition,
    beta: boolean,
    request: Request,
    observed: Omit<ObservedRequest, 'index'>,
  ): void {
    const url = new URL(request.url)
    rejectUnknownQuery(url, definition.id === 'models.list'
      ? new Set(['after_id', 'before_id', 'limit'])
      : new Set(['beta']))
    if (definition.id === 'models.list') {
      validateIntegerQuery(url, 'limit', 1, 1000)
      return
    }
    if (definition.requestSchema) {
      if (observed.body === undefined) { throw new Error(`Request body is required for ${definition.id}`) }
      this.#schemas.validate(anthropicVariantSchema(definition.requestSchema, beta), observed.body)
    }
  }
}

function openAiOperation(operationId: string): Record<string, unknown> {
  for (const [, pathItem] of openAiPathEntries) {
    for (const method of ['get', 'post', 'delete'] as const) {
      const operation = (
        pathItem as Record<string, { operationId?: string } | undefined>
      )[method]
      if (operation?.operationId === operationId) {
        return operation as Record<string, unknown>
      }
    }
  }
  throw new Error(`OpenAI snapshot operation "${operationId}" is not reachable`)
}

function validateParameters(
  registry: JsonSchemaRegistry,
  value: unknown,
  request: Request,
  pathParameters: Readonly<Record<string, string>>,
  baseAllowedQuery: ReadonlySet<string>,
): void {
  const url = new URL(request.url)
  const allowedQuery = new Set(baseAllowedQuery)
  if (!Array.isArray(value)) {
    rejectUnknownQuery(url, allowedQuery)
    return
  }
  for (const rawParameter of value) {
    const parameter = rawParameter as {
      readonly in?: string
      readonly name?: string
      readonly required?: boolean
      readonly schema?: object
    }
    if (!parameter.name || !parameter.schema) { continue }
    const raw = parameter.in === 'path'
      ? pathParameters[parameter.name]
      : parameter.in === 'query'
        ? queryValue(url, parameter.name)
        : parameter.in === 'header'
          ? request.headers.get(parameter.name) ?? undefined
          : undefined
    if (parameter.in === 'query') { allowedQuery.add(parameter.name) }
    if (raw === undefined) {
      if (parameter.required) { throw new Error(`Missing ${parameter.in} parameter "${parameter.name}"`) }
      continue
    }
    registry.validateOpenAiSchema(parameter.schema, raw, `parameter:${parameter.name}`)
  }
  rejectUnknownQuery(url, allowedQuery)
}

function queryValue(url: URL, name: string): JsonValue | undefined {
  const values = url.searchParams.getAll(name)
  if (values.length === 0) { return undefined }
  if (values.length > 1) { return values }
  const value = values[0]!
  if (/^-?\d+$/.test(value)) { return Number(value) }
  if (value === 'true' || value === 'false') { return value === 'true' }
  return value
}

function jsonSchema(value: unknown): object | undefined {
  if (!value || typeof value !== 'object') { return undefined }
  const record = value as Record<string, unknown>
  if (record.schema && typeof record.schema === 'object') { return record.schema as object }
  const content = record.content
  if (!content || typeof content !== 'object') { return undefined }
  const json = (content as Record<string, unknown>)['application/json']
  if (!json || typeof json !== 'object') { return undefined }
  const schema = (json as Record<string, unknown>).schema
  return schema && typeof schema === 'object' ? schema as object : undefined
}

function matchPath(template: string, path: string): Readonly<Record<string, string>> | undefined {
  const templateParts = template.split('/')
  const pathParts = path.split('/')
  if (templateParts.length !== pathParts.length) { return undefined }
  const parameters: Record<string, string> = {}
  for (let index = 0; index < templateParts.length; index += 1) {
    const expected = templateParts[index]!
    const actual = pathParts[index]!
    const parameter = /^\{(.+)\}$/.exec(expected)?.[1]
    if (parameter) {
      if (!actual) { return undefined }
      parameters[parameter] = decodeURIComponent(actual)
    }
    else if (expected !== actual) { return undefined }
  }
  return parameters
}

function isBeta(provider: Provider, request: Request): boolean {
  const url = new URL(request.url)
  return provider === 'openai'
    ? url.searchParams.get('beta') === 'true'
    : request.headers.has('anthropic-beta') || url.searchParams.get('beta') === 'true'
}

function anthropicVariantSchema(
  schemaId: ProtocolSchemaId,
  beta: boolean,
): ProtocolSchemaId {
  return beta
    ? schemaId.replace(':Anthropic', ':AnthropicBeta') as ProtocolSchemaId
    : schemaId
}

function rejectUnknownQuery(url: URL, allowed: ReadonlySet<string>): void {
  for (const name of url.searchParams.keys()) {
    if (!allowed.has(name)) { throw new Error(`Unknown query parameter "${name}"`) }
  }
}

function validateIntegerQuery(url: URL, name: string, minimum: number, maximum: number): void {
  const raw = url.searchParams.get(name)
  if (raw === null) { return }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Query parameter "${name}" must be an integer from ${minimum} to ${maximum}`)
  }
}
