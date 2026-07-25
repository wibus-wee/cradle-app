import { describe, expect, it } from 'vitest'

import { ScenarioController } from '../src/core/scenario-runtime'
import { createSimulatorApp } from '../src/server'

const headers = {
  'content-type': 'application/json',
  'x-api-key': 'fake',
  'anthropic-version': '2023-06-01',
}

const stableMessage = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'hello' }],
  container: null,
  stop_details: null,
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    input_tokens: 1,
    output_tokens: 1,
    output_tokens_details: null,
    service_tier: null,
  },
} as const

const validRequest = {
  model: 'claude-test',
  max_tokens: 8,
  messages: [{ role: 'user', content: 'hello' }],
} as const

const validCountRequest = {
  model: 'claude-test',
  messages: [{ role: 'user', content: 'hello' }],
} as const

describe('anthropic routes', () => {
  it('requires auth/version and returns provider-native errors', async () => {
    const controller = new ScenarioController()
    const app = createSimulatorApp(controller)
    const missing = await app.handle(
      new Request('http://simulator/v1/messages', { method: 'POST', body: '{}' }),
    )
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({ type: 'error' })

    const version = await app.handle(
      new Request('http://simulator/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': 'fake' },
        body: '{}',
      }),
    )
    expect(version.status).toBe(400)

    const excludedTool = await app.handle(
      new Request('http://simulator/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...validRequest,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }),
      }),
    )
    expect(excludedTool.status).toBe(400)
    expect(await excludedTool.json()).toMatchObject({
      error: { type: 'invalid_request_error' },
    })
    controller.assertExhausted()
  })

  it('serves non-streaming messages, token counts, models, and beta query form', async () => {
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'anthropic',
      exchanges: [
        {
          label: 'message',
          request: { method: 'POST', path: '/v1/messages' },
          response: {
            kind: 'json',
            body: {
              ...stableMessage,
              context_management: null,
              diagnostics: null,
              usage: {
                ...stableMessage.usage,
                fallback_credit: null,
                iterations: null,
                speed: null,
              },
            },
          },
        },
        {
          label: 'count',
          request: { method: 'POST', path: '/v1/messages/count_tokens' },
          response: {
            kind: 'json',
            body: { context_management: null, input_tokens: 3 },
          },
        },
        {
          label: 'models',
          request: { method: 'GET', path: '/v1/models' },
          response: { kind: 'json', body: { data: [], has_more: false, first_id: null, last_id: null } },
        },
      ],
    })
    const app = createSimulatorApp(controller)
    const message = await app.handle(
      new Request('http://simulator/v1/messages?beta=true', {
        method: 'POST',
        headers: { ...headers, 'anthropic-beta': 'test-beta' },
        body: JSON.stringify(validRequest),
      }),
    )
    expect(message.status).toBe(200)
    expect(message.headers.get('request-id')).toBeTruthy()
    const count = await app.handle(
      new Request('http://simulator/v1/messages/count_tokens?beta=true', {
        method: 'POST',
        headers,
        body: JSON.stringify(validCountRequest),
      }),
    )
    expect(await count.json()).toEqual({ context_management: null, input_tokens: 3 })
    const models = await app.handle(new Request('http://simulator/v1/models', { headers }))
    expect(models.status).toBe(200)
    controller.assertExhausted()
  })

  it('emits named SSE frames and rejects excluded variants before streaming', async () => {
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'anthropic',
      exchanges: [
        {
          label: 'stream',
          request: { method: 'POST', path: '/v1/messages' },
          response: {
            kind: 'stream',
            steps: [
              {
                kind: 'event',
                event: {
                  type: 'message_start',
                  message: { ...stableMessage, content: [], stop_reason: null },
                },
              },
              {
                kind: 'event',
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
                  },
                },
              },
              { kind: 'event', event: { type: 'message_stop' } },
              { kind: 'close' },
            ],
          },
        },
        {
          label: 'excluded',
          request: { method: 'POST', path: '/v1/messages' },
          response: {
            kind: 'stream',
            steps: [{ kind: 'event', event: { type: 'citation_delta' } }],
          },
        },
      ],
    })
    const app = createSimulatorApp(controller)
    const response = await app.handle(
      new Request('http://simulator/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...validRequest, stream: true }),
      }),
    )
    const text = await response.text()
    expect(text).toContain('event: message_start')
    expect(text).toContain('"type":"message_stop"')
    const excluded = await app.handle(
      new Request('http://simulator/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...validRequest, stream: true }),
      }),
    )
    expect(excluded.status).toBe(400)
    expect(await excluded.json()).toMatchObject({ type: 'error' })
    controller.assertExhausted()
  })
})
