import { describe, expect, it } from 'vitest'

import { startModelApiSimulator } from '../src'
import { createSimulatorApp, createSimulatorRuntime } from '../src/server'

const anthropicHeaders = {
  'content-type': 'application/json',
  'x-api-key': 'fake',
  'anthropic-version': '2023-06-01',
}

const openAiHeaders = {
  'authorization': 'Bearer fake',
  'content-type': 'application/json',
}

describe('autoRespond', () => {
  it('anthropic: count_tokens probe does not consume a queued messages exchange', async () => {
    const runtime = createSimulatorRuntime()
    const app = createSimulatorApp(runtime, { autoRespond: true })
    runtime.controller.enqueue({
      provider: 'anthropic',
      exchanges: [
        {
          label: 'conversation',
          request: { method: 'POST', path: '/v1/messages' },
          response: {
            kind: 'json',
            body: {
              id: 'msg_queued',
              type: 'message',
              role: 'assistant',
              model: 'claude-test',
              content: [{ type: 'text', text: 'queued', citations: null }],
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
                server_tool_use: null,
                service_tier: null,
              },
            },
          },
        },
      ],
    })

    const probe = await app.handle(new Request('http://simulator/v1/messages/count_tokens', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: 'claude-test',
        messages: [{ role: 'user', content: 'probe' }],
      }),
    }))
    expect(probe.status).toBe(200)
    expect(await probe.json()).toMatchObject({ input_tokens: expect.any(Number) })
    expect(runtime.controller.pendingExchangeCount).toBe(1)

    const turn = await app.handle(new Request('http://simulator/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: 'claude-test',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    }))
    if (turn.status !== 200) {
      throw new Error(`unexpected turn status ${turn.status}: ${await turn.text()}`)
    }
    expect(await turn.json()).toMatchObject({ id: 'msg_queued' })
    expect(() => runtime.controller.assertExhausted()).not.toThrow()
  })

  it('openai: models list and input_tokens do not consume a queued responses exchange', async () => {
    const runtime = createSimulatorRuntime()
    const app = createSimulatorApp(runtime, { autoRespond: true })
    const queuedBody = {
      id: 'resp_queued',
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
          content: [{ type: 'output_text', text: 'queued', annotations: [], logprobs: [] }],
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
    }
    runtime.controller.enqueue({
      provider: 'openai',
      exchanges: [
        {
          label: 'conversation',
          request: { method: 'POST', path: '/v1/responses', bodyFields: { '/stream': true } },
          response: { kind: 'json', body: queuedBody },
        },
      ],
    })

    const models = await app.handle(new Request('http://simulator/v1/models', {
      method: 'GET',
      headers: openAiHeaders,
    }))
    expect(models.status).toBe(200)
    expect(await models.json()).toMatchObject({ object: 'list' })

    const tokens = await app.handle(new Request('http://simulator/v1/responses/input_tokens', {
      method: 'POST',
      headers: openAiHeaders,
      body: JSON.stringify({ model: 'gpt-test', input: 'probe' }),
    }))
    expect(tokens.status).toBe(200)
    expect(await tokens.json()).toMatchObject({ object: 'response.input_tokens' })
    expect(runtime.controller.pendingExchangeCount).toBe(1)

    const turn = await app.handle(new Request('http://simulator/v1/responses', {
      method: 'POST',
      headers: openAiHeaders,
      body: JSON.stringify({ model: 'gpt-test', input: 'hello', stream: true }),
    }))
    expect(turn.status).toBe(200)
    expect(await turn.json()).toMatchObject({ id: 'resp_queued' })
    expect(() => runtime.controller.assertExhausted()).not.toThrow()
  })

  it('openai autoRespond streams a text reply when nothing is queued', async () => {
    const simulator = await startModelApiSimulator({ autoRespond: true })
    try {
      const response = await fetch(`${simulator.openaiBaseUrl}/responses`, {
        method: 'POST',
        headers: openAiHeaders,
        body: JSON.stringify({ model: 'gpt-test', input: 'ping', stream: true }),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const body = await response.text()
      expect(body).toContain('response.created')
      expect(body).toContain('[simulator] received: ping')
      expect(body).toContain('response.completed')
    }
    finally {
      await simulator.close()
    }
  })
})
