/**
 * Output: Codex runtime identity, static capabilities, and presentation projection.
 * Input: generated Codex app-server capability manifest.
 * Position: Codex provider package metadata owner.
 */

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  RuntimePresentationCapabilities,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server/capabilities'
import { projectCodexUiSlots } from './projection/ui-slot-projector'

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
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities

export function createCodexRuntimePresentation(): RuntimePresentationCapabilities {
  return {
    runtimeKind: CODEX_RUNTIME_KIND,
    slashCommands: [],
    uiSlots: projectCodexUiSlots(CODEX_APP_SERVER_CAPABILITIES),
    skills: [],
  }
}
