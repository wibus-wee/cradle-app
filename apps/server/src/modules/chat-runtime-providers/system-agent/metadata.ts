/**
 * Output: System Agent runtime identity and static capabilities.
 * Input: no runtime data.
 * Position: System Agent provider package metadata owner.
 */

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
} from '../../chat-runtime/runtime-provider-types'
import type { RuntimeDefaultActorDescriptor } from '../../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../../provider-contracts/types'

export const SYSTEM_AGENT_RUNTIME_KIND: RuntimeKind = 'jar-core'

export const SYSTEM_AGENT_RUNTIME_METADATA = {
  label: 'HiJarvis',
  description: 'Multi-surface AI agent with local memory',
  providerKinds: ['openai-compatible', 'anthropic', 'universal'],
  iconKey: 'hijarvis',
  surfaces: ['jarvis'],
  sortOrder: 10,
} satisfies ChatRuntimeMetadata

export const SYSTEM_AGENT_RUNTIME_ACTOR = {
  kind: 'system',
  id: 'jarvis',
  issueLabel: 'AI',
} satisfies RuntimeDefaultActorDescriptor

export const SYSTEM_AGENT_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: false,
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: false,
  supportsUiSlotStates: false,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities
