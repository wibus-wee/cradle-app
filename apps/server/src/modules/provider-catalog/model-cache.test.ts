import { afterEach, describe, expect, it } from 'vitest'

import {
  clearCachedModelRefreshFailure,
  getCachedModelRefreshFailure,
  setCachedModelRefreshFailure,
} from './model-cache'

const target = { kind: 'manual' as const, id: 'negative-cache-test-target' }

afterEach(() => {
  clearCachedModelRefreshFailure(target)
})

describe('provider model refresh failure cache', () => {
  it('holds a short-lived failure marker until a later successful refresh clears it', () => {
    expect(getCachedModelRefreshFailure(target)).toBeNull()

    setCachedModelRefreshFailure(target)
    expect(getCachedModelRefreshFailure(target)).toMatchObject({
      retryAfter: expect.any(Number),
    })

    clearCachedModelRefreshFailure(target)
    expect(getCachedModelRefreshFailure(target)).toBeNull()
  })
})
