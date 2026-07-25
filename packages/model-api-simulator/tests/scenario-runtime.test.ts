import { describe, expect, it } from 'vitest'

import type { SimulatorScenario } from '../src/contract'
import {
  DuplicateGateError,
  ScenarioController,
  ScenarioMismatchError,
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
    expect(() => controller.assertExhausted()).toThrow('Unconsumed exchanges: models')
  })

  it('matches structural JSON, query, and selected body fields without key-order sensitivity', () => {
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'openai',
      exchanges: [{
        label: 'structural',
        request: {
          method: 'POST',
          path: '/v1/responses',
          query: { beta: 'true' },
          body: { first: 1, second: { nested: true } },
          bodyFields: { '/second/nested': true },
        },
        response: { kind: 'json', body: {} },
      }],
    })
    controller.take('openai', {
      method: 'POST',
      path: '/v1/responses',
      query: { beta: 'true' },
      headers: {},
      body: { second: { nested: true }, first: 1 },
    })
    expect(() => controller.assertExhausted()).not.toThrow()
  })

  it('does not consume the head exchange on a typed mismatch', () => {
    const controller = new ScenarioController()
    controller.enqueue({
      provider: 'openai',
      exchanges: [{
        label: 'preserved',
        request: { method: 'GET', path: '/v1/models' },
        response: { kind: 'json', body: {} },
      }],
    })
    expect(() => controller.take('openai', {
      method: 'GET',
      path: '/v1/models/wrong',
      headers: {},
    })).toThrow(ScenarioMismatchError)
    expect(() => controller.take('openai', {
      method: 'GET',
      path: '/v1/models',
      headers: {},
    })).not.toThrow()
    expect(controller.requests().map(request => request.index)).toEqual([0, 1])
    controller.assertExhausted()
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
