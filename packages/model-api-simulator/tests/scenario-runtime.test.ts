import { describe, expect, it } from 'vitest'

import type { SimulatorScenario } from '../src/contract'
import {
  DuplicateGateError,
  ScenarioController,
  SimulatorScenarioError,
  UnknownGateError,
} from '../src/core/scenario-runtime'

describe('scenario controller', () => {
  it('accepts deeply readonly as-const fixtures without mutating them', () => {
    const scenario = {
      provider: 'openai',
      exchanges: [
        {
          label: 'deeply readonly fixture',
          request: {
            method: 'POST',
            path: '/v1/responses',
            body: {
              input: [
                {
                  role: 'user',
                  content: [{ type: 'input_text', text: 'hello' }],
                },
              ],
            },
          },
          response: {
            kind: 'json',
            body: {
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: 'world' }],
                },
              ],
            },
          },
        },
      ],
    } as const satisfies SimulatorScenario
    const fixtureBefore = JSON.stringify(scenario)
    const controller = new ScenarioController()

    controller.enqueue(scenario)
    controller.take('openai', {
      method: 'POST',
      path: '/v1/responses',
      headers: {},
      body: scenario.exchanges[0].request.body,
    })

    expect(JSON.stringify(scenario)).toBe(fixtureBefore)
    expect(() => controller.assertExhausted()).not.toThrow()
  })

  it('matches ordered provider-tagged exchanges and records requests', async () => {
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'anthropic',
      exchanges: [
        {
          label: 'message',
          request: { method: 'POST', path: '/v1/messages', body: { model: 'test' } },
          expectedHeaders: { 'x-api-key': 'fake' },
          response: { kind: 'json', body: {} },
        },
      ],
    })
    const waiting = controller.waitForRequest({ method: 'POST', path: '/v1/messages' })
    controller.take('anthropic', {
      method: 'POST',
      path: '/v1/messages',
      headers: { 'x-api-key': 'fake' },
      body: { model: 'test' },
    })
    await expect(waiting).resolves.toMatchObject({ index: 0 })
    expect(controller.requests()).toHaveLength(1)
    expect(() => controller.assertExhausted()).not.toThrow()
  })

  it('reports unexpected requests and unconsumed exchanges', () => {
    const controller = new ScenarioController()
    expect(() =>
      controller.take('openai', { method: 'GET', path: '/v1/models', headers: {} })).toThrow(SimulatorScenarioError)
    controller.enqueue({
      provider: 'openai',
      exchanges: [
        {
          label: 'models',
          request: { method: 'GET', path: '/v1/models' },
          response: { kind: 'json', body: {} },
        },
      ],
    })
    expect(() => controller.assertExhausted()).toThrow('1 exchange(s) remain')
  })

  it('rejects duplicate and unknown gate operations', async () => {
    const controller = new ScenarioController()
    const first = controller.waitAtGate('continue')
    expect(() => controller.waitAtGate('continue')).toThrow(DuplicateGateError)
    expect(() => controller.release('unknown')).toThrow(UnknownGateError)
    controller.release('continue')
    await first
    expect(() => controller.release('continue')).toThrow(UnknownGateError)
  })

  it('refuses reset while streams are open', () => {
    const controller = new ScenarioController()
    const untrack = controller.trackStream(() => undefined)
    expect(() => controller.reset()).toThrow('stream is open')
    untrack()
    expect(() => controller.reset()).not.toThrow()
  })
})
