import type {
  RuntimePresentationCapabilities,
  RuntimeUiSlot,
} from '../../chat-runtime/runtime-provider-types'
import {
  RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID,
} from '../../chat-runtime/runtime-provider-types'
import { STANDARD_RUNTIME_KIND } from './metadata'

/**
 * Fast mode for gateways that serve a `priority` tier. The tier itself is
 * declared per model, so this slot only says "the standard runtime knows how to
 * request a fast tier"; the composer narrows its availability to models whose
 * inventory actually declares one, and the provider refuses to send a tier the
 * target never declared.
 */
export const STANDARD_FAST_SERVICE_TIER_SLOT: RuntimeUiSlot = {
  id: 'standard:fast',
  name: 'fast',
  label: 'Fast',
  description: 'Use the model fast service tier.',
  argumentHint: '',
  iconKey: 'reasoning',
  commandText: '/fast ',
  commandAction: {
    kind: 'uiAction',
    actionId: RUNTIME_FAST_SERVICE_TIER_COMMAND_ACTION_ID,
  },
  requiresSession: true,
  surfaces: ['slashCommand'],
}

export function createStandardRuntimePresentation(): RuntimePresentationCapabilities {
  return {
    runtimeKind: STANDARD_RUNTIME_KIND,
    slashCommands: [],
    uiSlots: [STANDARD_FAST_SERVICE_TIER_SLOT],
    skills: [],
  }
}
