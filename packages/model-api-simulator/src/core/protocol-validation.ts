import type { JsonValue, ObservedRequest, StreamStep } from '../contract'
import { isJsonObject } from '../contract'
import { JsonSchemaRegistry } from './json-schema-registry'
import type { MatchedOperation, Provider } from './operation-registry'
import { OperationRegistry } from './operation-registry'

export class SimulatorProtocolValidator {
  readonly #schemas = new JsonSchemaRegistry()
  readonly #operations = new OperationRegistry()

  validateRequest(
    provider: Provider,
    request: Request,
    observed: Omit<ObservedRequest, 'index'>,
  ): MatchedOperation {
    const operation = this.#operations.match(provider, request)
    this.#operations.validateRequest(operation, request, observed)
    return operation
  }

  validateJsonResponse(
    operation: MatchedOperation,
    request: Request,
    status: number,
    body: JsonValue,
  ): void {
    this.#operations.validateResponse(operation, request, status, body)
  }

  validateStream(operation: MatchedOperation, steps: readonly StreamStep[]): void {
    const schemaId = operation.provider === 'anthropic'
      ? `anthropic:draft-07:${operation.beta ? 'AnthropicBeta' : 'Anthropic'}RawMessageStreamEvent` as const
      : `openai:2020-12:${operation.beta ? 'BetaResponseStreamEvent' : 'ResponseStreamEvent'}` as const
    for (const step of steps) {
      if (step.kind !== 'event') { continue }
      if (operation.provider === 'anthropic' && isJsonObject(step.event)) {
        if (step.event.type === 'ping') { continue }
        if (step.event.type === 'error') {
          this.#schemas.validate('anthropic:draft-07:AnthropicErrorResponse', step.event)
          continue
        }
      }
      this.#schemas.validate(schemaId, step.event)
    }
  }
}
