import { describe, expect, it } from 'vitest'

import { RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID } from '../../chat-runtime/runtime-provider-types'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server/capabilities'
import { createCodexRuntimePresentation } from './presentation'
import { projectCodexUiSlots } from './projection/ui-slot-projector'

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

  it('does not gate Fast mode on the model catalog', () => {
    const manifest = {
      ...CODEX_APP_SERVER_CAPABILITIES,
      clientMethods: CODEX_APP_SERVER_CAPABILITIES.clientMethods.filter(
        method => method.method !== 'model/list',
      ),
    }

    expect(projectCodexUiSlots(manifest)).toContainEqual(expect.objectContaining({
      id: 'codex:fast',
    }))
  })
})
