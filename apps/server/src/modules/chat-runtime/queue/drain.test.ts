import { describe, expect, it } from 'vitest'

import { AppError } from '../../../errors/app-error'
import { isDeferredQueueDrainError } from './drain'

describe('queue drain deferral', () => {
  it.each([
    'chat_run_in_progress',
    'chat_session_maintenance_in_progress',
  ])('releases the queue claim for %s', (code) => {
    expect(isDeferredQueueDrainError(new AppError({
      code,
      status: 409,
      message: 'retry later',
    }))).toBe(true)
  })

  it('keeps unrelated failures terminal', () => {
    expect(isDeferredQueueDrainError(new AppError({
      code: 'chat_provider_failed',
      status: 502,
      message: 'provider failed',
    }))).toBe(false)
  })
})
