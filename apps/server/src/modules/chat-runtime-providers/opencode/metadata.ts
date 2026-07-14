/**
 * Output: opencode runtime identity and static capabilities.
 * Input: no runtime data.
 * Position: opencode provider package metadata owner.
 */

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
} from '../../chat-runtime/runtime-provider-types'
import { readRuntimeSettingsSchema } from '../../chat-runtime/runtime-settings-registry'
import type { RuntimeKind } from '../../provider-contracts/types'

export const OPENCODE_RUNTIME_KIND: RuntimeKind = 'opencode'

export const OPENCODE_RUNTIME_METADATA = {
  label: 'Opencode',
  description: 'Opencode server runtime',
  providerKinds: ['openai-compatible', 'anthropic', 'universal'],
  // OpenCode owns its native config, auth, and provider lifecycle. Ordinary
  // Cradle provider targets must not be projected into the managed host.
  providerBinding: 'runtime-owned',
  iconKey: 'opencode',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 25,
  settingsSchema: readRuntimeSettingsSchema('opencode') ?? undefined,
} satisfies ChatRuntimeMetadata

export const OPENCODE_RUNTIME_CAPABILITIES = {
  steer: 'queue-fallback',
  supportsShellExecution: true,
  supportsLastTurnRollback: true,
  supportsRuntimeSettings: true,
  supportsUiSlotStates: true,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: true,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
