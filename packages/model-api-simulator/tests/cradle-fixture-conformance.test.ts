import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { ObservedRequest, SimulatorExchange } from '../src'
import { startModelApiSimulator } from '../src'
import { ScenarioController } from '../src/core/scenario-runtime'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'cradle')

function loadFixture(name: string): {
  method: string
  path: string
  body: unknown
} {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    method: string
    path: string
    body: unknown
  }
}

function asObserved(fixture: ReturnType<typeof loadFixture>, provider: 'anthropic' | 'openai'): ObservedRequest {
  return {
    provider,
    method: fixture.method,
    path: fixture.path,
    query: {},
    headers: {},
    body: fixture.body as ObservedRequest['body'],
    index: 0,
  }
}

describe('cradle Agent / Codex request fixtures', () => {
  it('matches Claude Agent messages-create fixture against a scripted stream exchange', () => {
    const fixture = loadFixture('claude-agent-messages-create.json')
    const controller = new ScenarioController()
    const exchange: SimulatorExchange = {
      label: 'claude-agent-fixture',
      request: {
        method: 'POST',
        path: '/v1/messages',
        bodyFields: { '/stream': true },
        bodyTextIncludes: '请先思考再回答',
      },
      response: {
        kind: 'stream',
        steps: [
          {
            kind: 'event',
            event: {
              type: 'message_start',
              message: {
                id: 'msg_fixture',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-4-5',
                content: [],
                container: null,
                context_management: null,
                diagnostics: null,
                stop_reason: null,
                stop_sequence: null,
                stop_details: null,
                usage: {
                  cache_creation: null,
                  input_tokens: 1,
                  output_tokens: 1,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                  fallback_credit: null,
                  inference_geo: null,
                  iterations: null,
                  output_tokens_details: null,
                  server_tool_use: null,
                  service_tier: null,
                  speed: null,
                },
              },
            },
          },
        ],
      },
    }
    controller.enqueue({ provider: 'anthropic', exchanges: [exchange] })
    expect(controller.nextMatches('anthropic', asObserved(fixture, 'anthropic'))).toBe(true)
    const matched = controller.take('anthropic', asObserved(fixture, 'anthropic'))
    expect(matched.label).toBe('claude-agent-fixture')
    controller.assertExhausted()
  })

  it('matches Codex responses-create fixture against a scripted stream exchange', () => {
    const fixture = loadFixture('codex-responses-create.json')
    const controller = new ScenarioController()
    const exchange: SimulatorExchange = {
      label: 'codex-fixture',
      request: {
        method: 'POST',
        path: '/v1/responses',
        bodyFields: { '/stream': true },
        bodyTextIncludes: 'Codex 精华第一轮',
      },
      response: {
        kind: 'stream',
        steps: [
          {
            kind: 'event',
            event: {
              type: 'response.created',
              sequence_number: 0,
              response: { id: 'resp_fixture', object: 'response', status: 'in_progress' },
            },
          },
        ],
      },
    }
    controller.enqueue({ provider: 'openai', exchanges: [exchange] })
    expect(controller.nextMatches('openai', asObserved(fixture, 'openai'))).toBe(true)
    const matched = controller.take('openai', asObserved(fixture, 'openai'))
    expect(matched.label).toBe('codex-fixture')
    controller.assertExhausted()
  })

  it('autoRespond Codex stream includes required logprobs on text deltas', async () => {
    const fixture = loadFixture('codex-responses-create.json')
    const simulator = await startModelApiSimulator({ autoRespond: true })
    try {
      const response = await fetch(`${simulator.openaiBaseUrl}/responses`, {
        method: 'POST',
        headers: {
          'authorization': 'Bearer sk-e2e-simulator',
          'content-type': 'application/json',
        },
        body: JSON.stringify(fixture.body),
      })
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toContain('response.output_text.delta')
      expect(text).toContain('"logprobs":[]')
    }
    finally {
      await simulator.close()
    }
  })
})
