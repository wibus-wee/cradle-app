import { describe, expect, it } from 'vitest'

import { RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID } from '../../chat-runtime/runtime-provider-types'
import { STANDARD_RUNTIME_KIND } from './metadata'
import { createStandardRuntimePresentation, STANDARD_FAST_SERVICE_TIER_SLOT } from './presentation'

describe('standard runtime presentation', () => {
  it('offers fast mode as a slash command action', () => {
    const presentation = createStandardRuntimePresentation()

    expect(presentation.runtimeKind).toBe(STANDARD_RUNTIME_KIND)
    expect(presentation.slashCommands).toEqual([])
    expect(presentation.skills).toEqual([])
    expect(presentation.uiSlots).toEqual([STANDARD_FAST_SERVICE_TIER_SLOT])
    expect(STANDARD_FAST_SERVICE_TIER_SLOT).toMatchObject({
      id: 'standard:fast',
      name: 'fast',
      commandText: '/fast ',
      requiresSession: true,
      surfaces: ['slashCommand'],
      commandAction: {
        kind: 'uiAction',
        actionId: RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID,
      },
    })
  })
})
