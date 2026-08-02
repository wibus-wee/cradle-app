import { describe, expect, it, vi } from 'vitest'

import { buildJarvisPromptText } from './build-jarvis-prompt'

vi.mock('./activity-jarvis-bridge', () => ({
  readRecentAmbientObservationTexts: () => [
    '[activity] segment ended: entity=file:a.ts type=file durationMs=45000 endReason=idle',
  ],
}))

vi.mock('./jarvis-ambient-session', () => ({
  readJarvisAmbientSessionId: () => null,
}))

vi.mock('./use-context-snapshot', () => ({
  collectContextEnvelope: () => ({
    collectedAt: 1,
    items: [{
      id: 'surface:home',
      kind: 'surface',
      title: 'Home',
      summary: 'Home surface',
      priority: 1,
      freshness: 1,
      sensitivity: 'normal',
      source: 'system',
      payload: {},
    }],
  }),
}))

vi.mock('./format-context', () => ({
  formatContextEnvelopeForAgent: () => '<cradle_context>\nhome\n</cradle_context>',
}))

describe('buildJarvisPromptText', () => {
  it('prepends ambient observations before the live cradle_context block', async () => {
    const result = await buildJarvisPromptText('hello', true)
    expect(result.startsWith('[activity] segment ended:')).toBe(true)
    expect(result).toContain('<cradle_context>')
    expect(result.indexOf('[activity]')).toBeLessThan(result.indexOf('<cradle_context>'))
    expect(result.endsWith('hello')).toBe(true)
  })

  it('omits ambient observations when includeContext is false', async () => {
    const result = await buildJarvisPromptText('hello', false)
    expect(result).not.toContain('[activity]')
    expect(result).toBe('hello')
  })
})
