import { afterEach, describe, expect, it } from 'vitest'

import { getTelemetryConfig, resetTelemetryConfigForTests } from './config'

const originalCaptureMode = process.env.CRADLE_POSTHOG_AI_CAPTURE_MODE

afterEach(() => {
  if (originalCaptureMode === undefined) {
    delete process.env.CRADLE_POSTHOG_AI_CAPTURE_MODE
  }
  else {
    process.env.CRADLE_POSTHOG_AI_CAPTURE_MODE = originalCaptureMode
  }
  resetTelemetryConfigForTests()
})

describe('postHog AI capture mode', () => {
  it('defaults to metadata', () => {
    delete process.env.CRADLE_POSTHOG_AI_CAPTURE_MODE
    resetTelemetryConfigForTests()
    expect(getTelemetryConfig().posthogAiCaptureMode).toBe('metadata')
  })

  it('accepts full and rejects unknown modes', () => {
    process.env.CRADLE_POSTHOG_AI_CAPTURE_MODE = 'full'
    resetTelemetryConfigForTests()
    expect(getTelemetryConfig().posthogAiCaptureMode).toBe('full')

    process.env.CRADLE_POSTHOG_AI_CAPTURE_MODE = 'everything'
    resetTelemetryConfigForTests()
    expect(getTelemetryConfig().posthogAiCaptureMode).toBe('metadata')
  })
})
