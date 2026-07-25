import { describe, expect, it } from 'vitest'

import { createSimulatorApp, createSimulatorRuntime } from '../src/server'

const headers = { 'authorization': 'Bearer fake', 'content-type': 'application/json' }
const responseFixture = {
  id: 'resp_1',
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
  output: [],
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
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 1,
  },
  metadata: {},
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
    const runtime = createSimulatorRuntime()
    const { controller } = runtime
    controller.enqueue({
      provider: 'openai',
      exchanges: operations.map(operation => ({
        label: `${operation.method} ${operation.path}`,
        request: { method: operation.method, path: operation.path },
        response: { kind: 'json' as const, body: operation.response },
      })),
    })
    const app = createSimulatorApp(runtime)
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
    const runtime = createSimulatorRuntime()
    const { controller } = runtime
    const app = createSimulatorApp(runtime)
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
    const runtime = createSimulatorRuntime()
    const { controller } = runtime
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
    const app = createSimulatorApp(runtime)
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

  it('serves a second client deterministically while the first stream is gated', async () => {
    const runtime = createSimulatorRuntime()
    const { controller } = runtime
    controller.enqueue({
      provider: 'openai',
      exchanges: [
        {
          label: 'gated stream',
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
              { kind: 'gate', name: 'finish-first-client' },
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
          label: 'concurrent models request',
          request: { method: 'GET', path: '/v1/models' },
          response: {
            kind: 'json',
            body: { object: 'list', data: [], has_more: false },
          },
        },
      ],
    })
    const app = createSimulatorApp(runtime)
    const stream = await app.handle(new Request('http://simulator/v1/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'gpt-test', input: 'hello', stream: true }),
    }))
    const reader = stream.body!.getReader()
    await expect(reader.read()).resolves.toMatchObject({ done: false })
    const gatedRead = reader.read()
    await controller.waitForGate('finish-first-client')

    const models = await app.handle(new Request('http://simulator/v1/models', { headers }))
    expect(models.status).toBe(200)
    expect(controller.requests().map(request => request.path)).toEqual([
      '/v1/responses',
      '/v1/models',
    ])

    controller.release('finish-first-client')
    await expect(gatedRead).resolves.toMatchObject({ done: false })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    controller.assertExhausted()
  })

  it('isolates scenario-owned response resources between simulator apps', async () => {
    const storedResponse = { ...responseFixture, status: 'in_progress' as const }
    const firstRuntime = createSimulatorRuntime()
    const { controller: firstController } = firstRuntime
    firstController.enqueue({
      provider: 'openai',
      exchanges: [
        {
          label: 'store in first simulator',
          request: { method: 'POST', path: '/v1/responses' },
          resourceEffect: {
            kind: 'store_response',
            response: storedResponse,
            inputItemPages: [],
          },
          response: { kind: 'json', body: storedResponse },
        },
        {
          label: 'retrieve from first simulator',
          request: { method: 'GET', path: '/v1/responses/resp_1' },
          resourceEffect: { kind: 'retrieve_response' },
          response: { kind: 'json', body: {} },
        },
      ],
    })
    const secondRuntime = createSimulatorRuntime()
    const { controller: secondController } = secondRuntime
    secondController.enqueue({
      provider: 'openai',
      exchanges: [{
        label: 'same id is absent from second simulator',
        request: { method: 'GET', path: '/v1/responses/resp_1' },
        resourceEffect: { kind: 'retrieve_response' },
        response: { kind: 'json', body: {} },
      }],
    })
    const first = createSimulatorApp(firstRuntime)
    const second = createSimulatorApp(secondRuntime)

    expect((await first.handle(new Request('http://simulator/v1/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'gpt-test', input: 'hello' }),
    }))).status).toBe(200)
    expect((await first.handle(new Request('http://simulator/v1/responses/resp_1', {
      headers,
    }))).status).toBe(200)
    expect((await second.handle(new Request('http://simulator/v1/responses/resp_1', {
      headers,
    }))).status).toBe(404)

    firstController.assertExhausted()
    secondController.assertExhausted()
  })

  it('clears stored response resources when the simulator controller resets', async () => {
    const runtime = createSimulatorRuntime()
    const { controller } = runtime
    const app = createSimulatorApp(runtime)
    const storedResponse = { ...responseFixture, status: 'in_progress' as const }
    controller.enqueue({
      provider: 'openai',
      exchanges: [{
        label: 'store response before reset',
        request: { method: 'POST', path: '/v1/responses' },
        resourceEffect: {
          kind: 'store_response',
          response: storedResponse,
          inputItemPages: [],
        },
        response: { kind: 'json', body: storedResponse },
      }],
    })

    expect((await app.handle(new Request('http://simulator/v1/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'gpt-test', input: 'hello' }),
    }))).status).toBe(200)
    controller.assertExhausted()

    controller.reset()
    controller.enqueue({
      provider: 'openai',
      exchanges: [{
        label: 'resource is absent after reset',
        request: { method: 'GET', path: '/v1/responses/resp_1' },
        resourceEffect: { kind: 'retrieve_response' },
        response: { kind: 'json', body: {} },
      }],
    })

    expect((await app.handle(new Request('http://simulator/v1/responses/resp_1', {
      headers,
    }))).status).toBe(404)
    expect(controller.requests()).toHaveLength(1)
    controller.assertExhausted()
  })
})
