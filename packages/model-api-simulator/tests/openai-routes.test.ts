import { describe, expect, it } from 'vitest'

import { ScenarioController } from '../src/core/scenario-runtime'
import { OpenAiResourceStore } from '../src/openai/resource-store'
import { createSimulatorApp } from '../src/server'

const headers = { 'authorization': 'Bearer fake', 'content-type': 'application/json' }
const responseFixture = {
  id: 'resp_1',
  object: 'response',
  created_at: 1,
  status: 'completed',
  error: null,
  incomplete_details: null,
  instructions: null,
  model: 'gpt-test',
  output: [],
  parallel_tool_calls: true,
  tools: [],
  metadata: {},
  tool_choice: 'auto',
  temperature: 1,
  top_p: 1,
} as const

describe('openAI routes', () => {
  it('requires Bearer auth and dispatches every response resource operation', async () => {
    const operations = [
      {
        method: 'POST',
        path: '/v1/responses',
        request: { model: 'gpt-test', input: 'hello' },
        response: responseFixture,
      },
      { method: 'GET', path: '/v1/responses/resp_1', response: responseFixture },
      {
        method: 'POST',
        path: '/v1/responses/resp_1/cancel',
        response: { ...responseFixture, status: 'cancelled' },
      },
      {
        method: 'GET',
        path: '/v1/responses/resp_1/input_items',
        response: { object: 'list', data: [], has_more: false, first_id: '', last_id: '' },
      },
      {
        method: 'POST',
        path: '/v1/responses/input_tokens',
        request: { model: 'gpt-test', input: 'hello' },
        response: { object: 'response.input_tokens', input_tokens: 1 },
      },
      {
        method: 'POST',
        path: '/v1/responses/compact',
        request: { model: 'gpt-test', input: 'hello' },
        response: {
          id: 'cmp_1',
          object: 'response.compaction',
          output: [],
          created_at: 1,
          usage: {
            input_tokens: 1,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 1,
          },
        },
      },
      { method: 'DELETE', path: '/v1/responses/resp_1', response: {} },
      { method: 'GET', path: '/v1/models', response: { object: 'list', data: [] } },
      {
        method: 'GET',
        path: '/v1/models/model_1',
        response: { id: 'model_1', object: 'model', created: 1, owned_by: 'simulator' },
      },
    ]
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'openai',
      exchanges: operations.map(operation => ({
        label: `${operation.method} ${operation.path}`,
        request: { method: operation.method, path: operation.path },
        response: { kind: 'json' as const, body: operation.response },
      })),
    })
    const app = createSimulatorApp(controller)
    expect(
      (
        await app.handle(
          new Request('http://simulator/v1/responses', { method: 'POST', body: '{}' }),
        )
      ).status,
    ).toBe(401)
    for (const { method, path, request } of operations) {
      const response = await app.handle(
        new Request(`http://simulator${path}`, {
          method,
          headers,
          ...(method === 'POST' ? { body: JSON.stringify(request ?? {}) } : {}),
        }),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('x-request-id')).toBeTruthy()
    }
    controller.assertExhausted()
  })

  it('rejects non-core request tool families before consuming a scenario', async () => {
    const controller = new ScenarioController()
    const app = createSimulatorApp(controller)
    const response = await app.handle(
      new Request('http://simulator/v1/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gpt-test',
          input: 'hello',
          tools: [{ type: 'web_search_preview' }],
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { type: 'invalid_request_error' },
    })
    controller.assertExhausted()
  })

  it('streams core events and rejects excluded events before bytes are written', async () => {
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'openai',
      exchanges: [
        {
          label: 'stream',
          request: { method: 'POST', path: '/v1/responses' },
          response: {
            kind: 'stream',
            steps: [
              {
                kind: 'event',
                event: {
                  type: 'response.created',
                  sequence_number: 0,
                  response: { ...responseFixture, status: 'in_progress' },
                },
              },
              {
                kind: 'event',
                event: {
                  type: 'response.completed',
                  sequence_number: 1,
                  response: responseFixture,
                },
              },
              { kind: 'close' },
            ],
          },
        },
        {
          label: 'excluded',
          request: { method: 'POST', path: '/v1/responses' },
          response: {
            kind: 'stream',
            steps: [
              { kind: 'event', event: { type: 'response.web_search_call.in_progress' } },
            ],
          },
        },
      ],
    })
    const app = createSimulatorApp(controller)
    const stream = await app.handle(
      new Request('http://simulator/v1/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'gpt-test', input: 'hello', stream: true }),
      }),
    )
    expect(await stream.text()).toContain('"type":"response.completed"')
    const excluded = await app.handle(
      new Request('http://simulator/v1/responses', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'gpt-test', input: 'hello', stream: true }),
      }),
    )
    expect(excluded.status).toBe(400)
    controller.assertExhausted()
  })

  it('owns deterministic resource state per store', () => {
    const first = new OpenAiResourceStore()
    const second = new OpenAiResourceStore()
    first.set({ id: 'resp_1', status: 'in_progress' })
    expect(second.retrieve('resp_1')).toBeUndefined()
    expect(first.cancel('resp_1')).toMatchObject({ status: 'cancelled' })
    expect(() => first.cancel('resp_1')).toThrow('not cancellable')
    expect(first.delete('resp_1')).toBe(true)
    expect(first.retrieve('resp_1')).toBeUndefined()
  })
})
