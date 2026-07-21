import type { ChatRuntimeCapabilities, ChatRuntimeMetadata } from '../../chat-runtime/runtime-provider-types'
import { readRuntimeSettingsSchema } from '../../chat-runtime/runtime-settings-registry'
import type { RuntimeKind } from '../../provider-contracts/types'

export const KIMI_RUNTIME_KIND: RuntimeKind = 'kimi'

export const KIMI_RUNTIME_METADATA = {
  label: 'Kimi',
  description: 'Kimi Code Web runtime',
  providerKinds: ['openai-compatible', 'anthropic', 'universal'],
  iconKey: 'kimi',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 30,
  settingsSchema: readRuntimeSettingsSchema('kimi') ?? undefined,
} satisfies ChatRuntimeMetadata

export const KIMI_RUNTIME_CAPABILITIES = {
  steer: 'native',
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: true,
  supportsUiSlotStates: true,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
