import { describe, expect, it } from 'vitest'

import { RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID } from '../../chat-runtime/runtime-provider-types'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server/capabilities'
import { createCodexRuntimePresentation } from './presentation'
import { applyCodexConfigRequirementSlotGates, projectCodexUiSlots } from './projection/ui-slot-projector'

describe('codex presentation feedback gating', () => {
  it('includes feedback when requirements leave feedback.enabled unset', () => {
    const presentation = createCodexRuntimePresentation({
      allowedApprovalPolicies: ['on-request'],
      feedback: { enabled: null },
    })
    expect(presentation.uiSlots.some(slot => slot.id === 'codex:feedback')).toBe(true)
  })

  it('omits feedback when config requirements disable it', () => {
    const presentation = createCodexRuntimePresentation({
      feedback: { enabled: false },
    })
    expect(presentation.uiSlots.some(slot => slot.id === 'codex:feedback')).toBe(false)
  })

  it('keeps feedback when requirements explicitly enable it', () => {
    const slots = applyCodexConfigRequirementSlotGates(
      projectCodexUiSlots(CODEX_APP_SERVER_CAPABILITIES),
      { feedback: { enabled: true } },
    )
    expect(slots.some(slot => slot.id === 'codex:feedback')).toBe(true)
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
