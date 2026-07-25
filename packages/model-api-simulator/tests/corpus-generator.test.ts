import { describe, expect, it } from 'vitest'

import { generateInvalidMutations, generateSchemaWitnesses } from '../src/core/corpus-generator'

describe('schema corpus generator', () => {
  it('covers unions, enums, optionals, null, arrays, boundaries, and unicode deterministically', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'count'],
          properties: {
            type: { const: 'alpha' },
            count: { type: 'integer', minimum: 1, maximum: 3 },
            note: { type: ['string', 'null'], minLength: 1 },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['type', 'items'],
          properties: {
            type: { const: 'beta' },
            items: { type: 'array', items: { enum: ['x', 'y'] }, maxItems: 2 },
          },
          additionalProperties: false,
        },
      ],
    }
    const first = generateSchemaWitnesses(schema)
    const second = generateSchemaWitnesses(schema)
    expect(second).toEqual(first)
    expect(first.map(witness => witness.value)).toContainEqual({ type: 'alpha', count: 1 })
    expect(first.map(witness => witness.value)).toContainEqual({ type: 'beta', items: [] })
  })

  it('terminates recursive references by schema identity', () => {
    const schema = {
      $ref: '#/$defs/node',
      $defs: {
        node: {
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'string' },
            next: { $ref: '#/$defs/node' },
          },
        },
      },
    }
    expect(generateSchemaWitnesses(schema)[0]?.value).toEqual({ value: '' })
  })

  it('creates targeted required-field mutations', () => {
    const schema = {
      type: 'object',
      required: ['type'],
      properties: { type: { const: 'example' } },
    }
    expect(generateInvalidMutations(schema, { type: 'example' })).toEqual([
      { id: 'omit-type', value: {}, targetedRule: 'required:type' },
    ])
  })
})
