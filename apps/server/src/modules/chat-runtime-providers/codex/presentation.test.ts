import { describe, expect, it } from 'vitest'

import { RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID } from '../../chat-runtime/runtime-provider-types'
import { createCodexRuntimePresentation } from './presentation'

describe('codex presentation', () => {
  it('does not expose the native feedback upload command', () => {
    expect(createCodexRuntimePresentation().uiSlots).not.toContainEqual(expect.objectContaining({
      id: 'codex:feedback',
    }))
  })

  it('declares the session-only Fast service-tier slash action', () => {
    expect(createCodexRuntimePresentation().uiSlots).toContainEqual(expect.objectContaining({
      id: 'codex:fast',
      name: 'fast',
      commandAction: {
        kind: 'uiAction',
        actionId: RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID,
      },
      requiresSession: true,
      surfaces: ['slashCommand'],
    }))
  })
})
