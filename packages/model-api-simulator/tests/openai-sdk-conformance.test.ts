import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'

import type { ModelApiSimulator, SimulatorExchange } from '../src'
import { startModelApiSimulator } from '../src'

const responseFixture = {
  id: 'resp_simulator',
  object: 'response',
  created_at: 1,
  status: 'completed',
  background: false,
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  max_tool_calls: null,
  model: 'gpt-test',
  output: [
    {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hello', annotations: [], logprobs: [] }],
    },
  ],
  parallel_tool_calls: true,
  previous_response_id: null,
  reasoning: null,
  service_tier: 'default',
  store: false,
  temperature: 1,
  text: { format: { type: 'text' } },
  tool_choice: 'auto',
  tools: [],
  top_p: 1,
  truncation: 'disabled',
  usage: {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
  },
  metadata: {},
} as const

function exchange(
  label: string,
  method: string,
  path: string,
  response: SimulatorExchange['response'],
): SimulatorExchange {
  return { label, request: { method, path }, response }
}

function createClient(simulator: ModelApiSimulator, urls: string[]): OpenAI {
  return new OpenAI({
    apiKey: 'fake-openai-key',
    baseURL: simulator.openaiBaseUrl,
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.hostname !== '127.0.0.1') { throw new Error(`Network escape: ${url.hostname}`) }
      urls.push(url.href)
      return fetch(input, init)
    },
  })
}

describe('openAI official SDK conformance', () => {
  it(
    'supports create, raw/final streams, resources, token count, compact, and models',
    async () => {
      const simulator = await startModelApiSimulator()
      const urls: string[] = []
      const storedResponse = { ...responseFixture, status: 'in_progress' as const }
      const simpleStream = [
        {
          kind: 'event' as const,
          event: { type: 'response.created', sequence_number: 0, response: responseFixture },
        },
        {
          kind: 'event' as const,
          event: { type: 'response.completed', sequence_number: 1, response: responseFixture },
        },
        { kind: 'close' as const },
      ]
      simulator.controller.enqueue({
        provider: 'openai',
        exchanges: [
          {
            ...exchange('create', 'POST', '/v1/responses', {
              kind: 'json',
              body: storedResponse,
            }),
            resourceEffect: {
              kind: 'store_response',
              response: storedResponse,
              inputItemPages: [{
                body: {
                  object: 'list',
                  data: [],
                  first_id: '',
                  last_id: '',
                  has_more: false,
                },
              }],
            },
          },
          exchange('raw', 'POST', '/v1/responses', { kind: 'stream', steps: simpleStream }),
          exchange('final', 'POST', '/v1/responses', { kind: 'stream', steps: simpleStream }),
          {
            ...exchange('retrieve', 'GET', '/v1/responses/resp_simulator', {
              kind: 'json',
              body: {},
            }),
            resourceEffect: { kind: 'retrieve_response' },
          },
          {
            ...exchange('cancel', 'POST', '/v1/responses/resp_simulator/cancel', {
              kind: 'json',
              body: {},
            }),
            resourceEffect: { kind: 'cancel_response' },
          },
          {
            ...exchange('items', 'GET', '/v1/responses/resp_simulator/input_items', {
              kind: 'json',
              body: {},
            }),
            resourceEffect: { kind: 'list_input_items' },
          },
          exchange('tokens', 'POST', '/v1/responses/input_tokens', {
            kind: 'json',
            body: { object: 'response.input_tokens', input_tokens: 4 },
          }),
          exchange('compact', 'POST', '/v1/responses/compact', {
            kind: 'json',
            body: {
              id: 'cmp_1',
              object: 'response.compaction',
              created_at: 1,
              output: [],
              usage: responseFixture.usage,
            },
          }),
          {
            ...exchange('delete', 'DELETE', '/v1/responses/resp_simulator', {
              kind: 'json',
              body: {},
            }),
            resourceEffect: { kind: 'delete_response' },
          },
          {
            ...exchange('retrieve deleted', 'GET', '/v1/responses/resp_simulator', {
              kind: 'json',
              body: {},
            }),
            resourceEffect: { kind: 'retrieve_response' },
          },
          exchange('models', 'GET', '/v1/models', {
            kind: 'json',
            body: {
              object: 'list',
              data: [{ id: 'gpt-test', object: 'model', created: 1, owned_by: 'simulator' }],
              has_more: false,
            },
          }),
          exchange('model', 'GET', '/v1/models/gpt-test', {
            kind: 'json',
            body: { id: 'gpt-test', object: 'model', created: 1, owned_by: 'simulator' },
          }),
        ],
      })
      const client = createClient(simulator, urls)
      try {
        expect((await client.responses.create({ model: 'gpt-test', input: 'hello' })).id).toBe(
          'resp_simulator',
        )
        const raw = await client.responses.create({
          model: 'gpt-test',
          input: 'hello',
          stream: true,
        })
        const types: string[] = []
        for await (const item of raw) { types.push(item.type) }
        expect(types).toEqual(['response.created', 'response.completed'])
        expect(
          (
            await client.responses
              .stream({ model: 'gpt-test', input: 'hello' })
              .finalResponse()
          ).id,
        ).toBe('resp_simulator')
        expect((await client.responses.retrieve('resp_simulator')).status).toBe('in_progress')
        expect((await client.responses.cancel('resp_simulator')).status).toBe('cancelled')
        expect((await client.responses.inputItems.list('resp_simulator')).data).toEqual([])
        expect((await client.responses.inputTokens.count({ model: 'gpt-test', input: 'hello' })).input_tokens).toBe(4)
        expect((await client.responses.compact({ model: 'gpt-test', input: 'hello' })).id).toBe('cmp_1')
        await client.responses.delete('resp_simulator')
        await expect(client.responses.retrieve('resp_simulator')).rejects.toMatchObject({
          status: 404,
        })
        expect((await client.models.list()).data[0]?.id).toBe('gpt-test')
        expect((await client.models.retrieve('gpt-test')).id).toBe('gpt-test')
        expect(urls.every(url => new URL(url).hostname === '127.0.0.1')).toBe(true)
        simulator.controller.assertExhausted()
      }
 finally {
        await simulator.close()
      }
    },
    15_000,
  )

  it('assembles function-call arguments and surfaces failed/disconnected streams', async () => {
    const simulator = await startModelApiSimulator()
    const urls: string[] = []
    const functionResponse = {
      ...responseFixture,
      output: [
        {
          id: 'item_1',
          type: 'function_call',
          call_id: 'call_1',
          name: 'read',
          arguments: '{"path":"file"}',
          status: 'completed',
        },
      ],
    }
    simulator.controller.enqueue({
      provider: 'openai',
      exchanges: [
        exchange('function', 'POST', '/v1/responses', {
          kind: 'stream',
          steps: [
            {
              kind: 'event',
              event: { type: 'response.created', sequence_number: 0, response: responseFixture },
            },
            {
              kind: 'event',
              event: {
                type: 'response.output_item.added',
                sequence_number: 1,
                output_index: 0,
                item: {
                  id: 'item_1',
                  type: 'function_call',
                  call_id: 'call_1',
                  name: 'read',
                  arguments: '',
                  status: 'in_progress',
                },
              },
            },
            {
              kind: 'event',
              event: {
                type: 'response.function_call_arguments.delta',
                sequence_number: 2,
                item_id: 'item_1',
                output_index: 0,
                delta: '{"path":',
              },
            },
            {
              kind: 'event',
              event: {
                type: 'response.function_call_arguments.delta',
                sequence_number: 3,
                item_id: 'item_1',
                output_index: 0,
                delta: '"file"}',
              },
            },
            {
              kind: 'event',
              event: {
                type: 'response.function_call_arguments.done',
                sequence_number: 4,
                item_id: 'item_1',
                name: 'read',
                output_index: 0,
                arguments: '{"path":"file"}',
              },
            },
            {
              kind: 'event',
              event: { type: 'response.completed', sequence_number: 5, response: functionResponse },
            },
            { kind: 'close' },
          ],
        }),
        exchange('failed', 'POST', '/v1/responses', {
          kind: 'stream',
          steps: [
            {
              kind: 'event',
              event: {
                type: 'response.failed',
                sequence_number: 0,
                response: {
                  ...responseFixture,
                  status: 'failed',
                  error: { code: 'server_error', message: 'fixture' },
                },
              },
            },
            { kind: 'close' },
          ],
        }),
        exchange('disconnect', 'POST', '/v1/responses', {
          kind: 'stream',
          steps: [
            {
              kind: 'event',
              event: { type: 'response.created', sequence_number: 0, response: responseFixture },
            },
            { kind: 'disconnect', reason: 'fixture disconnect' },
          ],
        }),
      ],
    })
    const client = createClient(simulator, urls)
    try {
      const final = await client.responses
        .stream({ model: 'gpt-test', input: 'hello' })
        .finalResponse()
      expect(final.output[0]).toMatchObject({
        type: 'function_call',
        arguments: '{"path":"file"}',
      })
      const failed = await client.responses.create({
        model: 'gpt-test',
        input: 'hello',
        stream: true,
      })
      const failedTypes: string[] = []
      for await (const item of failed) { failedTypes.push(item.type) }
      expect(failedTypes).toContain('response.failed')

      await expect(async () => {
        const disconnected = await client.responses.create({
          model: 'gpt-test',
          input: 'hello',
          stream: true,
        })
        for await (const _event of disconnected) {
          // consume until the transport error
        }
      }).rejects.toThrow()
      simulator.controller.assertExhausted()
    }
 finally {
      await simulator.close()
    }
  })
})
