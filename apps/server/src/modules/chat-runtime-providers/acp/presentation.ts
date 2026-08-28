import type {
  RuntimeContextUsage,
  RuntimeModeUiSlotState,
  RuntimePlanUiSlotState,
  RuntimePresentationCapabilities,
  RuntimeUiSlot,
  RuntimeUiSlotState,
} from '../../chat-runtime/runtime-provider-types'
import type { AcpSessionState } from './connection-manager'
import { ACP_RUNTIME_KIND } from './metadata'

const ACP_UI_SLOTS: RuntimeUiSlot[] = [
  { id: 'acp:mode', name: 'mode', label: 'Mode', description: 'Select the ACP session mode.', argumentHint: '', iconKey: 'config', surfaces: ['toolbarPicker', 'runtimePanel', 'composerState'] },
  { id: 'acp:plan', name: 'plan', label: 'Plan', description: 'Show the current ACP agent plan.', argumentHint: '', iconKey: 'plan', surfaces: ['runtimePanel', 'composerState'] },
  { id: 'acp:usage', name: 'usage', label: 'Context', description: 'Show ACP context usage.', argumentHint: '', iconKey: 'usage', surfaces: ['runtimePanel'] },
  { id: 'acp:terminal', name: 'terminal', label: 'Terminals', description: 'Show ACP terminals.', argumentHint: '', iconKey: 'terminal', surfaces: ['runtimePanel'] },
  { id: 'acp:user-input', name: 'questions', label: 'Questions', description: 'Show pending ACP questions.', argumentHint: '', iconKey: 'user-input', surfaces: ['runtimePanel', 'composerState'] },
]

export function createAcpPresentation(state?: AcpSessionState | null): RuntimePresentationCapabilities {
  return {
    runtimeKind: ACP_RUNTIME_KIND,
    slashCommands: (state?.availableCommands ?? []).map(command => ({
      name: command.name,
      description: command.description,
      argumentHint: command.input?.hint ?? '',
    })),
    uiSlots: ACP_UI_SLOTS,
    skills: [],
  }
}

export function projectAcpUiSlotStates(sessionId: string, state: AcpSessionState): RuntimeUiSlotState[] {
  const updatedAt = Math.floor(Date.now() / 1000)
  const states: RuntimeUiSlotState[] = []
  if (state.modes) {
    const modeState: RuntimeModeUiSlotState = {
      kind: 'mode',
      slotId: 'acp:mode',
      threadId: sessionId,
      currentModeId: state.modes.currentModeId,
      modes: state.modes.availableModes.map(mode => ({
        id: mode.id,
        name: mode.name,
        description: mode.description ?? '',
      })),
      updatedAt,
    }
    states.push(modeState)
  }
  const plan = state.plans.at(-1)
  if (plan) {
    const steps = plan.entries.map(entry => ({
      step: entry.content,
      status: entry.status === 'in_progress' ? 'inProgress' as const : entry.status,
    }))
    const planState: RuntimePlanUiSlotState = {
      kind: 'plan',
      slotId: 'acp:plan',
      threadId: sessionId,
      turnId: null,
      explanation: plan.uri,
      content: plan.content,
      steps,
      currentStep: steps.find(step => step.status === 'inProgress')?.step ?? null,
      pendingCount: steps.filter(step => step.status === 'pending').length,
      inProgressCount: steps.filter(step => step.status === 'inProgress').length,
      completedCount: steps.filter(step => step.status === 'completed').length,
      updatedAt,
    }
    states.push(planState)
  }
  return states
}

export function projectAcpContextUsage(providerSessionId: string, state: AcpSessionState): RuntimeContextUsage | null {
  if (!state.contextUsage) { return null }
  const { used, size, cost } = state.contextUsage
  return {
    runtimeKind: ACP_RUNTIME_KIND,
    providerSessionId,
    source: 'acp.session.usage_update',
    model: null,
    totalTokens: used,
    maxTokens: size,
    rawMaxTokens: size,
    percentage: size > 0 ? used / size * 100 : null,
    sections: [],
    messageBreakdown: null,
    apiUsage: cost ? { cost } : null,
    raw: state.contextUsage,
    updatedAt: Math.floor(Date.now() / 1000),
  }
}
