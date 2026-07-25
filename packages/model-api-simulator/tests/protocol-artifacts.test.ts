import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import anthropicManifest from '../protocol/anthropic/MANIFEST.json'
import scope from '../protocol/core-scope.json'
import openAiManifest from '../protocol/openai/MANIFEST.json'
import openAiDocument from '../protocol/openai/openapi.json'
import type { JsonValue } from '../src/contract'
import { JsonSchemaRegistry } from '../src/core/json-schema-registry'
import { OperationRegistry } from '../src/core/operation-registry'

interface LockFile {
  readonly overrides?: Readonly<Record<string, string>>
  readonly importers?: Readonly<Record<string, {
    readonly dependencies?: Readonly<Record<string, { readonly version?: string }>>
  }>>
  readonly packages?: Readonly<Record<string, {
    readonly resolution?: { readonly integrity?: string }
  }>>
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('protocol profile and operation registry', () => {
  it('retains exactly the allowlisted OpenAI operation identities', () => {
    const retained = Object.values(openAiDocument.paths).flatMap(pathItem =>
      ['get', 'post', 'delete'].flatMap((method) => {
        const operation = (pathItem as Record<string, { operationId?: string }>)[method]
        return operation?.operationId ? [operation.operationId] : []
      }))
    expect(retained.sort()).toEqual([...scope.openai.operations].sort())
    expect(retained).not.toContain('deleteModel')
  })

  it('resolves every runtime operation uniquely by exact method, path, and beta query', () => {
    const registry = new OperationRegistry()
    const cases = [
      ['openai', 'GET', '/v1/models', 'listModels'],
      ['openai', 'GET', '/v1/models/gpt-test', 'retrieveModel'],
      ['openai', 'POST', '/v1/responses', 'createResponse'],
      ['openai', 'POST', '/v1/responses?beta=true', 'beta_createResponse'],
      ['openai', 'GET', '/v1/responses/resp_1', 'getResponse'],
      ['openai', 'DELETE', '/v1/responses/resp_1', 'deleteResponse'],
      ['openai', 'POST', '/v1/responses/resp_1/cancel', 'cancelResponse'],
      ['openai', 'GET', '/v1/responses/resp_1/input_items', 'listInputItems'],
      ['openai', 'POST', '/v1/responses/compact', 'Compactconversation'],
      ['openai', 'POST', '/v1/responses/input_tokens', 'Getinputtokencounts'],
      ['anthropic', 'POST', '/v1/messages', 'messages.create'],
      ['anthropic', 'POST', '/v1/messages/count_tokens', 'messages.count_tokens'],
      ['anthropic', 'GET', '/v1/models', 'models.list'],
      ['anthropic', 'GET', '/v1/models/claude-test', 'models.retrieve'],
    ] as const
    for (const [provider, method, path, id] of cases) {
      expect(
        registry.match(provider, new Request(`http://simulator${path}`, { method })).id,
      ).toBe(id)
    }
    expect(() =>
      registry.match(
        'openai',
        new Request('http://simulator/v1/models/gpt-test', { method: 'DELETE' }),
      )).toThrow('Unsupported openai operation')
  })

  it('validates query, path, body, finite enum, and standard format schemas', () => {
    const operations = new OperationRegistry()
    const invalidQuery = new Request(
      'http://simulator/v1/responses/resp_1/input_items?limit=not-an-integer',
    )
    const operation = operations.match('openai', invalidQuery)
    expect(() => operations.validateRequest(operation, invalidQuery, {
      method: 'GET',
      path: '/v1/responses/resp_1/input_items',
      query: { limit: 'not-an-integer' },
      headers: {},
    })).toThrow('parameter:limit')

    const invalidAnthropicQuery = new Request('http://simulator/v1/models?limit=0')
    const anthropicOperation = operations.match('anthropic', invalidAnthropicQuery)
    expect(() => operations.validateRequest(
      anthropicOperation,
      invalidAnthropicQuery,
      {
        method: 'GET',
        path: '/v1/models',
        query: { limit: '0' },
        headers: {},
      },
    )).toThrow('must be an integer')

    const schemas = new JsonSchemaRegistry()
    expect(() => schemas.validateOpenAiSchema(
      { type: 'string', format: 'email' },
      'not-an-email',
      'format-check',
    )).toThrow('format')
  })

  it('rejects excluded branch identities structurally and contains no substring heuristic', async () => {
    const schemas = new JsonSchemaRegistry()
    const excludedRequest = {
      model: 'gpt-test',
      input: 'hello',
      tools: [{ type: 'apply_patch' }],
    } satisfies JsonValue
    expect(
      schemas.accepts('openai:2020-12:CreateResponse', excludedRequest),
    ).toBe(false)
    expect(
      schemas.accepts('openai:2020-12:CreateResponse', {
        model: 'gpt-test',
        input: 'hello',
        tools: [{ type: 'function', name: 'read', strict: false, parameters: {} }],
      }),
    ).toBe(true)

    const sources = await Promise.all([
      readFile(new URL('../scripts/protocol-utils.ts', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/refresh-openai-protocol.ts', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/refresh-anthropic-protocol.ts', import.meta.url), 'utf8'),
    ])
    expect(sources.join('\n')).not.toContain('excludedMarkers')
    expect(sources.join('\n')).not.toContain('normalizeIdentity')
  })

  it('binds protocol manifests and the Anthropic SDK alias to lockfile integrity', async () => {
    const [
      coreScope,
      openAiSnapshot,
      openAiGrammar,
      openAiTransitions,
      anthropicSchema,
      anthropicGrammar,
      anthropicTransitions,
      lockText,
    ] = await Promise.all([
      readFile(new URL('../protocol/core-scope.json', import.meta.url)),
      readFile(new URL('../protocol/openai/openapi.json', import.meta.url)),
      readFile(new URL('../protocol/openai/stream-grammar.json', import.meta.url)),
      readFile(new URL('../protocol/openai/transition-corpus.json', import.meta.url)),
      readFile(new URL('../protocol/anthropic/schema.json', import.meta.url)),
      readFile(new URL('../protocol/anthropic/stream-grammar.json', import.meta.url)),
      readFile(new URL('../protocol/anthropic/transition-corpus.json', import.meta.url)),
      readFile(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'),
    ])

    expect(openAiManifest.coreScopeSha256).toBe(sha256(coreScope))
    expect(openAiManifest.normalizedSha256).toBe(sha256(openAiSnapshot))
    expect(openAiManifest.grammarSha256).toBe(sha256(openAiGrammar))
    expect(openAiManifest.transitionCorpusSha256).toBe(sha256(openAiTransitions))
    expect(anthropicManifest.coreScopeSha256).toBe(sha256(coreScope))
    expect(anthropicManifest.schemaSha256).toBe(sha256(anthropicSchema))
    expect(anthropicManifest.grammarSha256).toBe(sha256(anthropicGrammar))
    expect(anthropicManifest.transitionCorpusSha256).toBe(sha256(anthropicTransitions))

    const lock = parse(lockText) as LockFile
    expect(anthropicManifest.packageIntegrity).toBe(
      lock.packages?.['@anthropic-ai/sdk@0.115.0']?.resolution?.integrity,
    )
    expect(lock.overrides?.['@anthropic-ai/claude-agent-sdk>@anthropic-ai/sdk']).toBe('0.81.0')
    expect(
      lock.importers?.['apps/server']
        ?.dependencies?.['@anthropic-ai/claude-agent-sdk']
        ?.version,
    ).toContain('@anthropic-ai/sdk@0.81.0')
  })
})
