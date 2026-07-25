import { describe, expect, it } from 'vitest'

import { startModelApiSimulator } from '../src'

describe('model API simulator lifecycle', () => {
  it('binds isolated loopback ports and closes idempotently', async () => {
    const first = await startModelApiSimulator()
    const second = await startModelApiSimulator()
    try {
      const firstUrl = new URL(first.anthropicBaseUrl)
      const secondUrl = new URL(second.anthropicBaseUrl)
      expect(firstUrl.hostname).toBe('127.0.0.1')
      expect(firstUrl.port).not.toBe(secondUrl.port)
      expect(first.openaiBaseUrl).toBe(`${firstUrl.origin}/v1`)
      await expect(fetch(`${firstUrl.origin}/v1/models`)).resolves.toMatchObject({
        status: 401,
      })
    }
 finally {
      await first.close()
      await first.close()
      await second.close()
    }
  })

  it('keeps controller state isolated', async () => {
    const first = await startModelApiSimulator()
    const second = await startModelApiSimulator()
    try {
      first.controller.enqueue({
        provider: 'anthropic',
        exchanges: [
          {
            label: 'one',
            request: { method: 'POST', path: '/v1/messages' },
            response: { kind: 'json', body: {} },
          },
        ],
      })
      expect(first.controller.requests()).toHaveLength(0)
      expect(() => first.controller.assertExhausted()).toThrow()
      expect(() => second.controller.assertExhausted()).not.toThrow()
    }
 finally {
      await Promise.all([first.close(), second.close()])
    }
  })
})
