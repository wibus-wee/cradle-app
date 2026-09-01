import { describe, expect, it } from 'vitest'

import { FabricTransportError, shouldRetryFabricRead } from './fabric-retry-policy'

describe('mobile Fabric retry policy', () => {
  it.each([
    ['GET', {}, new TypeError('offline')],
    ['HEAD', {}, new FabricTransportError('relay unavailable', 503)],
    ['GET', {}, new FabricTransportError('link interrupted')],
  ])('retries an unobserved idempotent read: %s', (method, init, error) => {
    expect(shouldRetryFabricRead(method, init, error)).toBe(true)
  })

  it.each([
    ['POST', {}, new TypeError('offline')],
    ['GET', { body: 'payload' }, new TypeError('offline')],
    ['GET', {}, new FabricTransportError('forbidden', 403)],
    ['GET', {}, new Error('invalid response')],
  ])('does not replay an unsafe or terminal request: %s', (method, init, error) => {
    expect(shouldRetryFabricRead(method, init, error)).toBe(false)
  })

  it('does not retry an aborted request', () => {
    const controller = new AbortController()
    controller.abort()

    expect(shouldRetryFabricRead('GET', { signal: controller.signal }, new TypeError('offline'))).toBe(false)
  })
})
