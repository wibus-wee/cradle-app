import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
} from '../../chat-runtime/runtime-provider-types'
import { readRuntimeSettingsSchema } from '../../chat-runtime/runtime-settings-registry'
import type { RuntimeKind } from '../../provider-contracts/types'

export const CODEX_RUNTIME_KIND: RuntimeKind = 'codex'

export const CODEX_RUNTIME_METADATA = {
  label: 'Codex',
  description: 'Codex app-server runtime',
  providerKinds: ['openai-compatible', 'universal'],
  iconKey: 'codex',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 20,
  settingsSchema: readRuntimeSettingsSchema('codex') ?? undefined,
} satisfies ChatRuntimeMetadata

export const CODEX_RUNTIME_CAPABILITIES = {
  steer: 'native',
  supportsShellExecution: true,
  supportsLastTurnRollback: true,
  supportsRuntimeSettings: true,
  supportsUiSlotStates: true,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: true,
  supportsNativeReview: true,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
