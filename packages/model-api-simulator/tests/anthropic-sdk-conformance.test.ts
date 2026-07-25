import Anthropic from 'anthropic-sdk-0-115'
import { describe, expect, it } from 'vitest'

import type { ModelApiSimulator, SimulatorExchange } from '../src'
import { startModelApiSimulator } from '../src'

const message = {
  id: 'msg_simulator',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'hello', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  container: null,
  stop_details: null,
  usage: {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    input_tokens: 1,
    output_tokens: 1,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
  },
} as const

const betaMessage = {
  ...message,
  context_management: null,
  diagnostics: null,
  usage: {
    ...message.usage,
    fallback_credit: null,
    iterations: null,
    speed: null,
  },
} as const

const streamSteps = [
  {
    kind: 'event' as const,
    event: { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
  },
  {
    kind: 'event' as const,
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '', citations: null },
    },
  },
  {
    kind: 'event' as const,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
  },
  { kind: 'event' as const, event: { type: 'content_block_stop', index: 0 } },
  {
    kind: 'event' as const,
    event: {
      type: 'message_delta',
      delta: {
        container: null,
        stop_details: null,
        stop_reason: 'end_turn',
        stop_sequence: null,
      },
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        input_tokens: 1,
        output_tokens: 1,
        output_tokens_details: null,
        server_tool_use: null,
      },
    },
  },
  { kind: 'event' as const, event: { type: 'message_stop' } },
  { kind: 'close' as const },
]

function exchange(
  label: string,
  method: string,
  path: string,
  response: SimulatorExchange['response'],
): SimulatorExchange {
  return { label, request: { method, path }, response }
}

function createClient(simulator: ModelApiSimulator, urls: string[]): Anthropic {
  return new Anthropic({
    apiKey: 'fake-anthropic-key',
    baseURL: simulator.anthropicBaseUrl,
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.hostname !== '127.0.0.1') { throw new Error(`Network escape: ${url.hostname}`) }
      urls.push(url.href)
      return fetch(input, init)
    },
  })
}

describe('anthropic official SDK conformance', () => {
  it(
    'supports non-streaming, raw/final streams, token counts, models, and beta fields',
    async () => {
      const simulator = await startModelApiSimulator()
      const urls: string[] = []
      simulator.controller.enqueue({
        provider: 'anthropic',
        exchanges: [
          exchange('create', 'POST', '/v1/messages', { kind: 'json', body: message }),
          exchange('raw stream', 'POST', '/v1/messages', { kind: 'stream', steps: streamSteps }),
          exchange('final stream', 'POST', '/v1/messages', { kind: 'stream', steps: streamSteps }),
          exchange('count', 'POST', '/v1/messages/count_tokens', {
            kind: 'json',
            body: { input_tokens: 3 },
          }),
          exchange('models', 'GET', '/v1/models', {
            kind: 'json',
            body: {
              data: [
                {
                  id: 'claude-test',
                  type: 'model',
                  display_name: 'Claude Test',
                  created_at: '2026-01-01T00:00:00Z',
                  capabilities: null,
                  max_input_tokens: null,
                  max_tokens: null,
                },
              ],
              has_more: false,
              first_id: 'claude-test',
              last_id: 'claude-test',
            },
          }),
          exchange('model', 'GET', '/v1/models/claude-test', {
            kind: 'json',
            body: {
              id: 'claude-test',
              type: 'model',
              display_name: 'Claude Test',
              created_at: '2026-01-01T00:00:00Z',
              capabilities: null,
              max_input_tokens: null,
              max_tokens: null,
            },
          }),
          exchange('beta', 'POST', '/v1/messages', { kind: 'json', body: betaMessage }),
        ],
      })
      const client = createClient(simulator, urls)
      try {
        expect((await client.messages.create({
          model: 'claude-test',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hello' }],
        })).id).toBe('msg_simulator')

        const raw = await client.messages.create({
          model: 'claude-test',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        })
        const rawTypes: string[] = []
        for await (const item of raw) { rawTypes.push(item.type) }
        expect(rawTypes).toContain('message_stop')

        const final = await client.messages
          .stream({
            model: 'claude-test',
            max_tokens: 8,
            messages: [{ role: 'user', content: 'hello' }],
          })
          .finalMessage()
        expect(final.content).toEqual([{ type: 'text', text: 'hello', citations: null }])

        expect(
          await client.messages.countTokens({
            model: 'claude-test',
            messages: [{ role: 'user', content: 'hello' }],
          }),
        ).toEqual({ input_tokens: 3 })
        const models = await client.models.list()
        expect(models.data[0]?.id).toBe('claude-test')
        expect((await client.models.retrieve('claude-test')).id).toBe('claude-test')
        expect(
          (
            await client.beta.messages.create({
              model: 'claude-test',
              max_tokens: 8,
              messages: [{ role: 'user', content: 'hello' }],
              output_config: { effort: 'high' },
              betas: ['effort-2025-11-24'],
            })
          ).id,
        ).toBe('msg_simulator')

        expect(urls.every(url => new URL(url).hostname === '127.0.0.1')).toBe(true)
        simulator.controller.assertExhausted()
      }
 finally {
        await simulator.close()
      }
    },
    15_000,
  )

  it('assembles split tool JSON and surfaces stream errors and abrupt disconnects', async () => {
    const simulator = await startModelApiSimulator()
    const urls: string[] = []
    const toolSteps = [
      {
        kind: 'event' as const,
        event: { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
      },
      {
        kind: 'event' as const,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_1',
            name: 'read',
            input: {},
            caller: { type: 'direct' },
          },
        },
      },
      {
        kind: 'event' as const,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":' },
        },
      },
      {
        kind: 'event' as const,
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"file"}' },
        },
      },
      { kind: 'event' as const, event: { type: 'content_block_stop', index: 0 } },
      {
        kind: 'event' as const,
        event: {
          type: 'message_delta',
          delta: {
            container: null,
            stop_details: null,
            stop_reason: 'tool_use',
            stop_sequence: null,
          },
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: 1,
            output_tokens: 1,
            output_tokens_details: null,
            server_tool_use: null,
          },
        },
      },
      { kind: 'event' as const, event: { type: 'message_stop' } },
      { kind: 'close' as const },
    ]
    simulator.controller.enqueue({
      provider: 'anthropic',
      exchanges: [
        exchange('tool', 'POST', '/v1/messages', { kind: 'stream', steps: toolSteps }),
        exchange('stream error', 'POST', '/v1/messages', {
          kind: 'stream',
          steps: [
            {
              kind: 'event',
              event: {
                type: 'error',
                request_id: 'req_stream_error',
                error: { type: 'overloaded_error', message: 'fixture stream error' },
              },
            },
            { kind: 'close' },
          ],
        }),
        exchange('disconnect', 'POST', '/v1/messages', {
          kind: 'stream',
          steps: [
            toolSteps[0]!,
            { kind: 'disconnect', reason: 'fixture disconnect' },
          ],
        }),
      ],
    })
    const client = createClient(simulator, urls)
    try {
      const final = await client.messages
        .stream({
          model: 'claude-test',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hello' }],
        })
        .finalMessage()
      expect(final.content[0]).toMatchObject({ type: 'tool_use', input: { path: 'file' } })

      await expect(async () => {
        const errored = await client.messages.create({
          model: 'claude-test',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        })
        for await (const _event of errored) {
          // consume until the provider stream error
        }
      }).rejects.toThrow('fixture stream error')

      await expect(async () => {
        const disconnected = await client.messages.create({
          model: 'claude-test',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hello' }],
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
