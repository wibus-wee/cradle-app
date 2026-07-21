import type { RuntimePresentationCapabilities, RuntimeUiSlot } from '../../chat-runtime/runtime-provider-types'
import { KIMI_RUNTIME_KIND } from './metadata'

const KIMI_UI_SLOTS: RuntimeUiSlot[] = [
  { id: 'kimi:status', name: 'status', label: 'Status', description: 'Show Kimi session state.', argumentHint: '', iconKey: 'status', commandText: '/status ', surfaces: ['runtimePanel'] },
  { id: 'kimi:model', name: 'model', label: 'Model', description: 'Show the active Kimi model.', argumentHint: '', iconKey: 'model', commandText: '/model ', surfaces: ['runtimePanel', 'composerState'] },
  { id: 'kimi:config', name: 'config', label: 'Configuration', description: 'Show Kimi interaction configuration.', argumentHint: '', iconKey: 'config', commandText: '/config ', surfaces: ['runtimePanel'] },
  { id: 'kimi:plan', name: 'plan', label: 'Plan', description: 'Show Kimi plan mode.', argumentHint: '', iconKey: 'plan', commandText: '/plan ', surfaces: ['runtimePanel', 'composerState'] },
  { id: 'kimi:usage', name: 'usage', label: 'Usage', description: 'Show Kimi context usage.', argumentHint: '', iconKey: 'usage', commandText: '/usage ', surfaces: ['runtimePanel'] },
  { id: 'kimi:goal', name: 'goal', label: 'Goal', description: 'Show Kimi goal progress.', argumentHint: '', iconKey: 'progress', commandText: '/goal ', surfaces: ['runtimePanel', 'composerState'] },
  { id: 'kimi:approvals', name: 'approvals', label: 'Approvals', description: 'Show pending Kimi tool approvals.', argumentHint: '', iconKey: 'approvals', commandText: '/approvals ', surfaces: ['runtimePanel', 'composerState'] },
  { id: 'kimi:questions', name: 'questions', label: 'Questions', description: 'Show pending Kimi questions.', argumentHint: '', iconKey: 'user-input', commandText: '/questions ', surfaces: ['runtimePanel', 'composerState'] },
  { id: 'kimi:tasks', name: 'tasks', label: 'Tasks', description: 'Show Kimi background tasks.', argumentHint: '', iconKey: 'progress', commandText: '/tasks ', surfaces: ['runtimePanel'] },
  { id: 'kimi:terminal', name: 'terminal', label: 'Terminals', description: 'Show Kimi terminals.', argumentHint: '', iconKey: 'terminal', commandText: '/terminal ', surfaces: ['runtimePanel'] },
  { id: 'kimi:mcp', name: 'mcp', label: 'MCP', description: 'Show Kimi MCP servers.', argumentHint: '', iconKey: 'mcp', commandText: '/mcp ', surfaces: ['runtimePanel'] },
  { id: 'kimi:skills', name: 'skills', label: 'Skills', description: 'Show Kimi skills.', argumentHint: '', iconKey: 'skills', commandText: '/skills ', surfaces: ['runtimePanel'] },
]

export function createKimiRuntimePresentation(): RuntimePresentationCapabilities {
  return { runtimeKind: KIMI_RUNTIME_KIND, slashCommands: [], uiSlots: KIMI_UI_SLOTS, skills: [] }
}
