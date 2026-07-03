/**
 * Output: Standard runtime identity and static capabilities.
 * Input: no runtime data.
 * Position: OpenAI-compatible provider package metadata owner.
 */

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'

export const STANDARD_RUNTIME_KIND = 'standard' as const satisfies RuntimeKind

export const STANDARD_RUNTIME_METADATA = {
  label: 'Standard',
  description: 'Direct OpenAI-compatible chat runtime',
  providerKinds: ['openai-compatible', 'universal'],
  iconKey: 'custom',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 50,
} satisfies ChatRuntimeMetadata

export const STANDARD_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: false,
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
