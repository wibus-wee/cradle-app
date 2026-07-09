/**
 * Output: Claude Agent runtime identity, static capabilities, and presentation projection.
 * Input: Claude Agent SDK slash command metadata.
 * Position: Claude Agent provider package metadata owner.
 */

import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

import type {
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  RuntimePresentationCapabilities,
  RuntimeSlashCommand,
  RuntimeUiSlot,
} from '../../chat-runtime/runtime-provider-types'
import { readRuntimeSettingsSchema } from '../../chat-runtime/runtime-settings-registry'
import type { RuntimeKind } from '../../provider-contracts/types'

export const CLAUDE_AGENT_RUNTIME_KIND: RuntimeKind = 'claude-agent'

export const CLAUDE_AGENT_RUNTIME_METADATA = {
  label: 'Claude Agent',
  description: 'Claude Agent SDK runtime',
  providerKinds: ['anthropic', 'universal'],
  iconKey: 'claude-agent',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 30,
  settingsSchema: readRuntimeSettingsSchema('claude-agent') ?? undefined,
  composer: {
    inputMode: 'rich',
    modelSelection: 'alias-matrix',
    thinking: {
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
  },
} satisfies ChatRuntimeMetadata

export const CLAUDE_AGENT_RUNTIME_CAPABILITIES = {
  steer: 'native',
  supportsShellExecution: false,
  supportsLastTurnRollback: false,
  supportsRuntimeSettings: true,
  supportsUiSlotStates: true,
  supportsDynamicCapabilities: false,
  supportsTitleGeneration: true,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities

const CLAUDE_AGENT_COMPACT_SLOT: RuntimeUiSlot = {
  id: 'claude-agent:compact',
  name: 'compact',
  label: 'Compact',
  description: 'Compact this conversation context.',
  argumentHint: '',
  aliases: ['summarize'],
  iconKey: 'compact',
  commandText: '/compact ',
  surfaces: ['runtimePanel'],
}

const CLAUDE_AGENT_QUICK_QUESTION_SLOT: RuntimeUiSlot = {
  id: 'claude-agent:quick-question',
  name: 'btw',
  label: 'Quick question',
  description: 'Ask a quick question without saving it to history.',
  argumentHint: '[question]',
  aliases: ['quick-question'],
  iconKey: 'quick-question',
  commandText: '/btw ',
  surfaces: ['slashCommand', 'composerState'],
}

const CLAUDE_AGENT_PLAN_SLOT: RuntimeUiSlot = {
  id: 'claude-agent:plan',
  name: 'plan',
  label: 'Plan',
  description: 'Show the current execution plan.',
  argumentHint: '',
  iconKey: 'plan',
  commandText: '/plan ',
  surfaces: ['composerState', 'runtimePanel'],
}

const CLAUDE_AGENT_PROGRESS_SLOT: RuntimeUiSlot = {
  id: 'claude-agent:progress',
  name: 'progress',
  label: 'Progress',
  description: 'Show the current task progress.',
  argumentHint: '',
  iconKey: 'progress',
  surfaces: ['composerState', 'runtimePanel'],
}

const CLAUDE_AGENT_USER_INPUT_SLOT: RuntimeUiSlot = {
  id: 'claude-agent:user-input',
  name: 'ask-user',
  label: 'Ask user',
  description: 'Show pending runtime questions for the user.',
  argumentHint: '',
  iconKey: 'user-input',
  surfaces: ['composerState', 'runtimePanel', 'streamEvidence'],
}

const CLAUDE_AGENT_CREW_SLOT: RuntimeUiSlot = {
  id: 'claude-agent:crew',
  name: 'crew',
  label: 'Crew',
  description: 'Show active sub-agents and crew status.',
  argumentHint: '',
  iconKey: 'crew',
  surfaces: ['runtimePanel'],
}

export function projectClaudeAgentPresentation(slashCommands: SlashCommand[]): RuntimePresentationCapabilities {
  return {
    runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
    slashCommands: slashCommands.map(toRuntimeSlashCommand),
    uiSlots: [
      CLAUDE_AGENT_COMPACT_SLOT,
      CLAUDE_AGENT_QUICK_QUESTION_SLOT,
      CLAUDE_AGENT_PLAN_SLOT,
      CLAUDE_AGENT_PROGRESS_SLOT,
      CLAUDE_AGENT_USER_INPUT_SLOT,
      CLAUDE_AGENT_CREW_SLOT,
    ],
    skills: [],
  }
}

function toRuntimeSlashCommand(command: SlashCommand): RuntimeSlashCommand {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
  }
}
