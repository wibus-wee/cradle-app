import type { ErrorObject, ValidateFunction } from 'ajv'
import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

import anthropicCatalogue from '../../protocol/anthropic/schema.json'
import openAiDocument from '../../protocol/openai/openapi.json'
import type { JsonValue } from '../contract'

export type ProtocolSchemaId = `anthropic:draft-07:${string}` | `openai:2020-12:${string}`

export class ProtocolValidationError extends Error {
  override readonly name = 'ProtocolValidationError'

  constructor(
    readonly schemaId: ProtocolSchemaId,
    readonly errors: readonly ErrorObject[],
  ) {
    super(
      `Value failed ${schemaId}: ${errors.map(error => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ')}`,
    )
  }
}

export class JsonSchemaRegistry {
  readonly #validators = new Map<ProtocolSchemaId, ValidateFunction>()
  readonly #draft07 = new Ajv({
    allErrors: true,
    discriminator: true,
    strict: false,
    validateFormats: false,
  })

  readonly #draft2020 = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  })

  constructor() {
    addFormats(this.#draft07)
    addFormats(this.#draft2020)
  }

  validate<T extends JsonValue>(schemaId: ProtocolSchemaId, value: JsonValue): T {
    const validate = this.#validator(schemaId)
    if (!validate(value)) { throw new ProtocolValidationError(schemaId, validate.errors ? [...validate.errors] : []) }
    return value as T
  }

  accepts(schemaId: ProtocolSchemaId, value: JsonValue): boolean {
    return this.#validator(schemaId)(value) as boolean
  }

  #validator(schemaId: ProtocolSchemaId): ValidateFunction {
    const cached = this.#validators.get(schemaId)
    if (cached) { return cached }
    const [provider, , name] = schemaId.split(':')
    if (!name) { throw new Error(`Invalid protocol schema ID: ${schemaId}`) }
    const schema
      = provider === 'anthropic'
        ? anthropicCatalogue.catalogues[name as keyof typeof anthropicCatalogue.catalogues]
        : openAiDocument.components.schemas[name as keyof typeof openAiDocument.components.schemas]
    if (!schema) { throw new Error(`Unknown protocol schema ID: ${schemaId}`) }
    const validate
      = provider === 'anthropic'
        ? this.#draft07.compile(schema)
        : this.#draft2020.compile({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $ref: `#/components/schemas/${name}`,
            components: openAiDocument.components,
          })
    this.#validators.set(schemaId, validate)
    return validate
  }
}
