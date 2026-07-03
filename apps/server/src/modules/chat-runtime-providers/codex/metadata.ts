/**
 * Output: Codex runtime identity, static capabilities, and presentation projection.
 * Input: generated Codex app-server capability manifest.
 * Position: Codex provider package metadata owner.
 */

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'

export const CODEX_RUNTIME_KIND: RuntimeKind = 'codex'

export const CODEX_RUNTIME_METADATA = {
  label: 'Codex',
  description: 'Codex app-server runtime',
  providerKinds: ['openai-compatible', 'universal'],
  iconKey: 'codex',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 20,
} satisfies ChatRuntimeMetadata

export const CODEX_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: true,
  supportsShellExecution: true,
  supportsLastTurnRollback: true,
  supportsRuntimeSettings: true,
  supportsUiSlotStates: true,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: true,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
