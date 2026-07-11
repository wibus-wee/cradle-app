import { describe, expect, it } from 'vitest'

import {
  POSTHOG_AI_EXPORT_ATTRIBUTE,
  posthogAiOtlpUrl,
  shouldExportPostHogAiSpan,
} from './posthog-ai'

describe('postHog AI OTLP routing', () => {
  it('builds the PostHog AI Observability endpoint', () => {
    expect(posthogAiOtlpUrl('https://us.i.posthog.com/'))
      .toBe('https://us.i.posthog.com/i/v0/ai/otel')
  })

  it('exports only explicitly marked AI spans', () => {
    expect(shouldExportPostHogAiSpan({
      attributes: { [POSTHOG_AI_EXPORT_ATTRIBUTE]: true },
    })).toBe(true)
    expect(shouldExportPostHogAiSpan({ attributes: {} })).toBe(false)
  })
})
