import Ajv from 'ajv'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  enumerateSchemaObligations,
  generateInvalidMutations,
  generateSchemaWitnesses,
  UnsupportedSchemaConstructError,
} from '../src/core/corpus-generator'

const ajv = new Ajv({ allErrors: true, strict: false })

describe('schema corpus generator', () => {
  it('covers real schema paths for nested unions, enums, optionals, null, arrays, and bounds', () => {
    const schema = {
      $defs: {
        item: {
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
        },
      },
      type: 'object',
      required: ['requiredItem'],
      properties: {
        requiredItem: { $ref: '#/$defs/item' },
        optionalItem: { $ref: '#/$defs/item' },
      },
      additionalProperties: { type: 'string' },
    }
    const first = generateSchemaWitnesses(schema)
    const second = generateSchemaWitnesses(schema)
    const obligations = enumerateSchemaObligations(schema)
    const covered = new Set(first.flatMap(witness => witness.covers))

    expect(second).toEqual(first)
    expect(obligations.every(obligation => covered.has(obligation))).toBe(true)
    expect(obligations).toEqual(expect.arrayContaining([
      '#/$defs/item:oneOf:0',
      '#/$defs/item:oneOf:1',
      '#/$defs/item/oneOf/1/properties/items/items:enum:0',
      '#/$defs/item/oneOf/1/properties/items/items:enum:1',
      '#:optional:optionalItem:absent',
      '#:optional:optionalItem:present',
      '#:additionalProperties:present',
    ]))
    const validate = ajv.compile(schema)
    expect(first.every(witness => validate(witness.value))).toBe(true)
  })

  it('covers zero and one recursive expansion by reference identity', () => {
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
    const witnesses = generateSchemaWitnesses(schema)
    const obligations = enumerateSchemaObligations(schema)
    expect(obligations).toContain('#/$defs/node/properties/next:recursion:zero')
    expect(obligations).toContain('#/$defs/node/properties/next:recursion:one')
    expect(witnesses.map(witness => witness.value)).toContainEqual({ value: '' })
    expect(witnesses.some(witness =>
      JSON.stringify(witness.value).includes('"next"'))).toBe(true)
    const validate = ajv.compile(schema)
    expect(witnesses.every(witness => validate(witness.value))).toBe(true)
  })

  it('creates meaningful required, discriminator, primitive, and bound negatives', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'count'],
          properties: {
            type: { const: 'bounded' },
            count: { type: 'integer', maximum: 3 },
          },
        },
        {
          type: 'object',
          required: ['type', 'text'],
          properties: {
            type: { const: 'text' },
            text: { type: 'string', maxLength: 3 },
          },
        },
      ],
    }
    const validate = ajv.compile(schema)
    const witnesses = generateSchemaWitnesses(schema).filter(witness => validate(witness.value))
    const mutations = witnesses.flatMap(witness =>
      generateInvalidMutations(schema, witness.value))
    expect(mutations.some(mutation => mutation.targetedRule.includes('required'))).toBe(true)
    expect(mutations.some(mutation => mutation.targetedRule.includes('discriminator'))).toBe(true)
    expect(mutations.some(mutation => mutation.targetedRule.includes(':type'))).toBe(true)
    expect(mutations.some(mutation =>
      mutation.targetedRule.includes('maximum')
      || mutation.targetedRule.includes('maxLength'))).toBe(true)
    expect(mutations.some(mutation => !validate(mutation.value))).toBe(true)
  })

  it('covers formatted strings with valid deterministic ASCII witnesses', () => {
    const schema = {
      type: 'object',
      required: ['fileUrl'],
      properties: {
        fileUrl: { type: 'string', format: 'uri' },
      },
    }
    const formatAjv = new Ajv({ allErrors: true, strict: false })
    formatAjv.addFormat('uri', value => URL.canParse(value))
    const validate = formatAjv.compile(schema)
    const witnesses = generateSchemaWitnesses(schema)
    const obligations = enumerateSchemaObligations(schema)
    const covered = new Set(
      witnesses.filter(witness => validate(witness.value)).flatMap(witness => witness.covers),
    )

    expect(obligations).toContain('#/properties/fileUrl:string:ascii')
    expect(obligations.every(obligation => covered.has(obligation))).toBe(true)
  })

  it('fails with a schema path for unsupported reachable constructs', () => {
    expect(() => generateSchemaWitnesses({
      type: 'object',
      properties: {
        value: { if: { type: 'string' }, then: { minLength: 1 } },
      },
    })).toThrow(UnsupportedSchemaConstructError)
    expect(() => generateSchemaWitnesses({
      type: 'object',
      properties: {
        value: { if: { type: 'string' }, then: { minLength: 1 } },
      },
    })).toThrow('#/properties/value')
  })

  it('is deterministic under fixed-seed property generation', () => {
    const seed = 0x1A2B3C4D
    try {
      fc.assert(
        fc.property(
          fc.array(fc.string({ maxLength: 8 }), { minLength: 1, maxLength: 6 }),
          fc.integer({ min: -20, max: 20 }),
          (rawValues, minimum) => {
            const values = [...new Set(rawValues)]
            const schema = {
              type: 'object',
              required: ['choice', 'count'],
              properties: {
                choice: { enum: values },
                count: { type: 'integer', minimum, maximum: minimum + 4 },
                optional: { type: ['string', 'null'] },
              },
            }
            expect(generateSchemaWitnesses(schema)).toEqual(generateSchemaWitnesses(schema))
          },
        ),
        { seed, numRuns: 100 },
      )
    }
    catch (error) {
      throw new Error(`fast-check seed ${seed}\n${String(error)}`)
    }
  })
})
