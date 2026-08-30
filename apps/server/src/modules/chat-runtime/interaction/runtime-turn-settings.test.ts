import { beforeEach, describe, expect, it } from 'vitest'

import { runRegistry } from '../run-registry'
import { updateChatRuntimeTurnSettings } from './runtime-turn-settings'

describe('updateChatRuntimeTurnSettings', () => {
  beforeEach(() => {
    runRegistry.clearAll()
  })

  it('returns targetUnavailable when the session has no active provider turn', async () => {
    await expect(updateChatRuntimeTurnSettings({
      sessionId: 'session-1',
      settings: { model: 'gpt-5.1-codex' },
    })).resolves.toEqual({ status: 'targetUnavailable' })
  })
})
