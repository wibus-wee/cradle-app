/**
 * Output: opencode runtime presentation projection.
 * Input: opencode SDK command records.
 * Position: opencode provider package boundary from SDK-native presentation to Chat Runtime presentation.
 */

import type { Command as OpencodeCommand } from '@opencode-ai/sdk'

import type {
  RuntimePresentationCapabilities,
  RuntimeSlashCommand,
  RuntimeUiSlot,
} from '../../chat-runtime/runtime-provider-types'
import { OPENCODE_RUNTIME_KIND } from './metadata'

const OPENCODE_QUICK_QUESTION_SLOT: RuntimeUiSlot = {
  id: 'opencode:quick-question',
  name: 'btw',
  label: 'Quick question',
  description: 'Ask a quick question without saving it to history.',
  argumentHint: '[question]',
  aliases: ['quick-question'],
  iconKey: 'quick-question',
  commandText: '/btw ',
  surfaces: ['slashCommand', 'composerState'],
}

const OPENCODE_STATUS_SLOT: RuntimeUiSlot = {
  id: 'opencode:status',
  name: 'status',
  label: 'Status',
  description: 'Show the current opencode session status.',
  argumentHint: '',
  iconKey: 'status',
  commandText: '/status ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_MODEL_SLOT: RuntimeUiSlot = {
  id: 'opencode:model',
  name: 'model',
  label: 'Model',
  description: 'Show the current opencode model.',
  argumentHint: '',
  iconKey: 'model',
  commandText: '/model ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_TERMINAL_SLOT: RuntimeUiSlot = {
  id: 'opencode:terminal',
  name: 'terminal',
  label: 'Terminal',
  description: 'Run shell commands through opencode.',
  argumentHint: '[command]',
  iconKey: 'terminal',
  commandText: '/terminal ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_PROGRESS_SLOT: RuntimeUiSlot = {
  id: 'opencode:progress',
  name: 'progress',
  label: 'Progress',
  description: 'Show the current opencode todo list.',
  argumentHint: '',
  iconKey: 'progress',
  commandText: '/progress ',
  surfaces: ['runtimePanel', 'composerState'],
}

const OPENCODE_DIFF_SLOT: RuntimeUiSlot = {
  id: 'opencode:diff',
  name: 'diff',
  label: 'Diff',
  description: 'Show the current opencode file diff summary.',
  argumentHint: '',
  iconKey: 'diff',
  commandText: '/diff ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_APPROVALS_SLOT: RuntimeUiSlot = {
  id: 'opencode:approvals',
  name: 'approvals',
  label: 'Approvals',
  description: 'Show pending and recent opencode permission requests.',
  argumentHint: '',
  iconKey: 'approvals',
  commandText: '/approvals ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_MCP_SLOT: RuntimeUiSlot = {
  id: 'opencode:mcp',
  name: 'mcp',
  label: 'MCP',
  description: 'Show opencode MCP server status.',
  argumentHint: '',
  iconKey: 'mcp',
  commandText: '/mcp ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_FILESYSTEM_SLOT: RuntimeUiSlot = {
  id: 'opencode:filesystem',
  name: 'filesystem',
  label: 'Files',
  description: 'Show opencode workspace file changes.',
  argumentHint: '',
  iconKey: 'filesystem',
  commandText: '/files ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_CONFIG_SLOT: RuntimeUiSlot = {
  id: 'opencode:config',
  name: 'config',
  label: 'Config',
  description: 'Show opencode runtime configuration summary.',
  argumentHint: '',
  iconKey: 'config',
  commandText: '/config ',
  surfaces: ['runtimePanel'],
}

const OPENCODE_CREW_SLOT: RuntimeUiSlot = {
  id: 'opencode:crew',
  name: 'agents',
  label: 'Agents',
  description: 'Show opencode subagents created by the current session.',
  argumentHint: '',
  iconKey: 'crew',
  commandText: '/agents ',
  surfaces: ['runtimePanel'],
}

export function createOpencodeRuntimePresentation(
  commands: OpencodeCommand[] = [],
): RuntimePresentationCapabilities {
  return {
    runtimeKind: OPENCODE_RUNTIME_KIND,
    slashCommands: commands.map(projectOpencodeSlashCommand),
    uiSlots: [
      OPENCODE_QUICK_QUESTION_SLOT,
      OPENCODE_STATUS_SLOT,
      OPENCODE_MODEL_SLOT,
      OPENCODE_TERMINAL_SLOT,
      OPENCODE_PROGRESS_SLOT,
      OPENCODE_DIFF_SLOT,
      OPENCODE_APPROVALS_SLOT,
      OPENCODE_MCP_SLOT,
      OPENCODE_FILESYSTEM_SLOT,
      OPENCODE_CONFIG_SLOT,
      OPENCODE_CREW_SLOT,
    ],
    skills: [],
  }
}

function projectOpencodeSlashCommand(command: OpencodeCommand): RuntimeSlashCommand {
  return {
    name: command.name,
    description: command.description ?? '',
    argumentHint: '',
  }
}
