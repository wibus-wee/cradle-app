import { describe, expect, it } from 'vitest'

import { normalizeConstSchemas } from '../scripts/openapi-schema-normalizer'

describe('normalizeConstSchemas', () => {
  it('normalizes a standalone string const into an OpenAPI enum', () => {
    const schema = { const: 'rrule' }

    normalizeConstSchemas(schema)

    expect(schema).toEqual({ type: 'string', enum: ['rrule'] })
  })

  it('normalizes string const unions and their nullable form', () => {
    const schema = {
      anyOf: [{ const: 'file_ref' }, { const: 'text' }],
    }
    const nullableSchema = {
      anyOf: [{ const: 'agent_complete' }, { type: 'null' }],
    }

    normalizeConstSchemas(schema)
    normalizeConstSchemas(nullableSchema)

    expect(schema).toEqual({ type: 'string', enum: ['file_ref', 'text'] })
    expect(nullableSchema).toEqual({ type: 'string', enum: ['agent_complete', null], nullable: true })
  })

  it('leaves non-string constants and ordinary objects unchanged', () => {
    const numericConstant = { const: 42 }
    const object = { type: 'object', properties: { enabled: { type: 'boolean' } } }

    normalizeConstSchemas(numericConstant)
    normalizeConstSchemas(object)

    expect(numericConstant).toEqual({ const: 42 })
    expect(object).toEqual({ type: 'object', properties: { enabled: { type: 'boolean' } } })
  })
})
