/**
 * Output: ACP Chat runtime identity and static capabilities.
 * Input: no runtime data.
 * Position: ACP provider package metadata owner.
 */

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../../provider-contracts/types'

export const ACP_RUNTIME_KIND = 'acp-chat' as const satisfies RuntimeKind

export const ACP_RUNTIME_METADATA = {
  label: 'ACP Chat',
  description: 'Cloud Agent SDK runtime',
  providerKinds: ['openai-compatible', 'anthropic', 'universal'],
  iconKey: 'custom',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 40,
  stability: 'experimental',
  degradations: [
    {
      capability: 'runtime',
      status: 'experimental',
      reason: 'ACP agent implementations vary; Cradle currently supports chat streaming and bridged tool approvals only.',
    },
    {
      capability: 'steerTurn',
      status: 'unsupported',
      reason: 'ACP live steering is not mapped into the Chat Runtime contract.',
    },
    {
      capability: 'lastTurnRollback',
      status: 'unsupported',
      reason: 'ACP session rollback is not mapped into the Chat Runtime contract.',
    },
    {
      capability: 'runtimeSettings',
      status: 'unsupported',
      reason: 'ACP config changes are provider-specific and not normalized as runtime settings.',
    },
  ],
} satisfies ChatRuntimeMetadata

export const ACP_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: false,
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
