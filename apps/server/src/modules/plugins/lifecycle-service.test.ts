import { describe, expect, it } from 'vitest'

import { pluginLifecycle } from './lifecycle-service'

describe('plugin lifecycle reviews', () => {
  it('binds a pending review to the originating chat until review completion', () => {
    const sourceId = `source-${crypto.randomUUID()}`
    const chatSessionId = `session-${crypto.randomUUID()}`

    pluginLifecycle.publish({
      type: 'source-installed',
      sourceId,
      pluginIdentities: ['@personal/example'],
      chatSessionId,
    })

    expect(pluginLifecycle.listPendingReviews(chatSessionId)).toEqual([
      expect.objectContaining({ sourceId, chatSessionId }),
    ])

    pluginLifecycle.publish({
      type: 'review-completed',
      sourceId,
      pluginIdentities: ['@personal/example'],
      chatSessionId: null,
    })

    expect(pluginLifecycle.listPendingReviews(chatSessionId)).toEqual([])
  })
})
