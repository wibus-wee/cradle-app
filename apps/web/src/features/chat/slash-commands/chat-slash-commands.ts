import {
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
} from '@cradle/chat-runtime-contracts'

import type {
  ChatRuntimeAlertUiSlotState,
  ChatRuntimeApprovalsUiSlotState,
  ChatRuntimeCapabilities,
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeConfigUiSlotState,
  ChatRuntimeCrewUiSlotState,
  ChatRuntimeDiffUiSlotState,
  ChatRuntimeFilesystemUiSlotState,
  ChatRuntimeGoalUiSlotState,
  ChatRuntimeMcpUiSlotState,
  ChatRuntimeModelUiSlotState,
  ChatRuntimePlanUiSlotState,
  ChatRuntimePluginUiSlotState,
  ChatRuntimeReasoningUiSlotState,
  ChatRuntimeSearchUiSlotState,
  ChatRuntimeSkillsUiSlotState,
  ChatRuntimeStatusUiSlotState,
  ChatRuntimeTerminalUiSlotState,
  ChatRuntimeToolActivityUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
  ChatRuntimeUsageUiSlotState,
  ChatRuntimeUserInputUiSlotState,
  ChatSlashCommand,
} from '../capabilities/chat-capabilities'

export type ChatSlashCommandSource = 'runtime' | 'cradle'
export type ChatSlashCommandPresentation = 'command' | 'slot'
export type ChatSlashCommandIconKey
  = | 'appshot'
    | 'alert'
    | 'approvals'
    | 'code-review'
    | 'compact'
    | 'config'
    | 'crew'
    | 'diff'
    | 'feedback'
    | 'filesystem'
    | 'goal'
    | 'ide-context'
    | 'mcp'
    | 'model'
    | 'personality'
    | 'plugin'
    | 'plan'
    | 'progress'
    | 'quick-question'
    | 'user-input'
    | 'reasoning'
    | 'search'
    | 'side-chat'
    | 'skills'
    | 'status'
    | 'terminal'
    | 'tool-activity'
    | 'usage'

export type ChatSlashCommandAction
  = | { kind: 'insertText', text: string }
    | { kind: 'submitText', text: string, requiresEmptyComposer?: boolean }
    | { kind: 'uiAction', actionId: string }

export type RuntimeComposerSlashCommandMode = 'session' | 'draft'

export type ChatSlashCommandStateVisual = {
  kind: 'compactUsage'
  percent: number | null
  status: ChatRuntimeCompactUiSlotState['status']
}

export interface ChatComposerSlashCommand {
  id: string
  name: string
  description: string
  argumentHint: string
  label?: string
  aliases?: string[]
  source: ChatSlashCommandSource
  action: ChatSlashCommandAction
  presentation?: ChatSlashCommandPresentation
  iconKey?: ChatSlashCommandIconKey
  stateLabel?: string
  stateTone?: 'neutral' | 'success' | 'warning' | 'danger'
  stateVisual?: ChatSlashCommandStateVisual
  availability?: {
    enabled: boolean
    reason: string
  }
}

export const CRADLE_APPSHOT_SLASH_ACTION_ID = 'capture-appshot'
export {
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
}
const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const CRADLE_APPSHOT_SLASH_COMMAND: ChatComposerSlashCommand = {
  id: 'cradle:appshot',
  name: 'appshot',
  description: 'Capture the frontmost app window',
  argumentHint: '',
  source: 'cradle',
  action: { kind: 'uiAction', actionId: CRADLE_APPSHOT_SLASH_ACTION_ID },
  iconKey: 'appshot',
}

export const CRADLE_SIDE_CHAT_SLASH_COMMAND: ChatComposerSlashCommand = {
  id: 'cradle:side-chat',
  name: 'side',
  description: 'Start a side conversation from this chat',
  argumentHint: '[message]',
  aliases: ['branch-chat'],
  source: 'cradle',
  action: { kind: 'insertText', text: '/side ' },
  iconKey: 'side-chat',
}

export interface MergeChatSlashCommandsInput {
  runtimeCommands: ChatSlashCommand[]
  runtimeUiSlotCommands?: ChatComposerSlashCommand[]
  cradleCommands: ChatComposerSlashCommand[]
}

export interface ProjectRuntimeComposerSlashCommandsInput {
  capabilities?: ChatRuntimeCapabilities | null
  slotStates?: ChatRuntimeUiSlotState[]
  mode?: RuntimeComposerSlashCommandMode
  cradleCommands?: ChatComposerSlashCommand[]
  mapRuntimeUiSlotCommand?: (command: ChatComposerSlashCommand) => ChatComposerSlashCommand
}

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, '')
}

function isRuntimeUiSlotSlashCommand(
  slot: ChatRuntimeUiSlot,
  mode: RuntimeComposerSlashCommandMode,
): boolean {
  if (mode === 'draft' && slot.requiresSession) {
    return false
  }
  return slot.surfaces.includes('slashCommand')
}

function readRuntimeUiSlotAction(
  slot: ChatRuntimeUiSlot,
  commandText: string,
): ChatSlashCommandAction {
  switch (slot.commandAction?.kind) {
    case 'submitText':
      return {
        kind: 'submitText',
        text: commandText.trim(),
        requiresEmptyComposer: slot.commandAction.requiresEmptyComposer,
      }
    case 'uiAction':
      return { kind: 'uiAction', actionId: slot.commandAction.actionId }
    case 'insertText':
    default:
      return { kind: 'insertText', text: commandText }
  }
}

export function createRuntimeSlashCommand(
  command: ChatSlashCommand,
  index = 0,
): ChatComposerSlashCommand {
  const name = normalizeCommandName(command.name)
  return {
    id: `runtime:${name}:${index}`,
    name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
    source: 'runtime',
    action: { kind: 'insertText', text: `/${name} ` },
  }
}

export function createRuntimeUiSlotCommand(
  slot: ChatRuntimeUiSlot,
  slotStates: ChatRuntimeUiSlotState[] = [],
): ChatComposerSlashCommand {
  const name = normalizeCommandName(slot.name)
  const state = readRuntimeUiSlotCommandState(slot, slotStates)
  const commandText = slot.commandText ?? `/${name} `
  return {
    id: slot.id,
    name,
    label: slot.label,
    description: slot.description,
    argumentHint: slot.argumentHint,
    aliases: slot.aliases,
    source: 'runtime',
    action: readRuntimeUiSlotAction(slot, commandText),
    presentation: 'slot',
    iconKey: slot.iconKey,
    stateLabel: state?.label,
    stateTone: state?.tone,
    stateVisual: state?.visual ?? readDefaultRuntimeUiSlotCommandVisual(slot),
  }
}

export function createRuntimeUiSlotCommands(
  slots: ChatRuntimeUiSlot[],
  slotStates: ChatRuntimeUiSlotState[] = [],
  mode: RuntimeComposerSlashCommandMode = 'session',
): ChatComposerSlashCommand[] {
  return slots
    .filter(slot => isRuntimeUiSlotSlashCommand(slot, mode))
    .map(slot => createRuntimeUiSlotCommand(slot, slotStates))
}

export function mergeChatSlashCommands({
  runtimeCommands,
  runtimeUiSlotCommands = [],
  cradleCommands,
}: MergeChatSlashCommandsInput): ChatComposerSlashCommand[] {
  const enabledCradleCommands = cradleCommands.filter(
    command => command.availability?.enabled !== false,
  )
  const disabledCradleCommands = cradleCommands.filter(
    command => command.availability?.enabled === false,
  )
  return [
    ...runtimeUiSlotCommands,
    ...enabledCradleCommands,
    ...runtimeCommands.map(createRuntimeSlashCommand),
    ...disabledCradleCommands,
  ]
}

export function projectRuntimeComposerSlashCommands({
  capabilities,
  slotStates = [],
  mode = 'session',
  cradleCommands = [],
  mapRuntimeUiSlotCommand,
}: ProjectRuntimeComposerSlashCommandsInput): ChatComposerSlashCommand[] {
  const runtimeUiSlotCommands = createRuntimeUiSlotCommands(
    capabilities?.uiSlots ?? [],
    slotStates,
    mode,
  ).map(command => (mapRuntimeUiSlotCommand ? mapRuntimeUiSlotCommand(command) : command))

  return mergeChatSlashCommands({
    runtimeCommands: capabilities?.slashCommands ?? [],
    runtimeUiSlotCommands,
    cradleCommands,
  })
}

export function withSlashCommandAvailability(
  command: ChatComposerSlashCommand,
  availability: ChatComposerSlashCommand['availability'],
): ChatComposerSlashCommand {
  return { ...command, availability }
}

export function hasDuplicateSlashCommandName(
  commands: ChatComposerSlashCommand[],
  command: ChatComposerSlashCommand,
): boolean {
  const name = command.name.toLowerCase()
  return commands.some(
    candidate => candidate !== command && candidate.name.toLowerCase() === name,
  )
}

export function getSlashCommandSourceLabel(command: ChatComposerSlashCommand): string {
  return command.source === 'runtime' ? 'Runtime' : 'Cradle'
}

function readRuntimeUiSlotCommandState(
  slot: ChatRuntimeUiSlot,
  states: ChatRuntimeUiSlotState[],
): {
  label: string
  tone?: ChatComposerSlashCommand['stateTone']
  visual?: ChatSlashCommandStateVisual
} | null {
  const state = states.find(candidate => candidate.slotId === slot.id)
  if (!state) {
    return null
  }
  switch (state.kind) {
    case 'alert':
      return readAlertCommandState(state)
    case 'approvals':
      return readApprovalsCommandState(state)
    case 'compact':
      return readCompactCommandState(state)
    case 'config':
      return readConfigCommandState(state)
    case 'crew':
      return readCrewCommandState(state)
    case 'diff':
      return readDiffCommandState(state)
    case 'filesystem':
      return readFilesystemCommandState(state)
    case 'goal':
      return readGoalCommandState(state)
    case 'mcp':
      return readMcpCommandState(state)
    case 'model':
      return readModelCommandState(state)
    case 'plan':
      return readPlanCommandState(state)
    case 'plugin':
      return readPluginCommandState(state)
    case 'reasoning':
      return readReasoningCommandState(state)
    case 'search':
      return readSearchCommandState(state)
    case 'skills':
      return readSkillsCommandState(state)
    case 'status':
      return readStatusCommandState(state)
    case 'terminal':
      return readTerminalCommandState(state)
    case 'toolActivity':
      return readToolActivityCommandState(state)
    case 'usage':
      return readUsageCommandState(state)
    case 'userInput':
      return readUserInputCommandState(state)
    default:
      return null
  }
}

function readDefaultRuntimeUiSlotCommandVisual(
  slot: ChatRuntimeUiSlot,
): ChatSlashCommandStateVisual | undefined {
  if (slot.iconKey !== 'compact') {
    return undefined
  }
  return {
    kind: 'compactUsage',
    percent: null,
    status: 'idle',
  }
}

function readCompactCommandState(
  state: ChatRuntimeCompactUiSlotState,
): {
  label: string
  tone?: ChatComposerSlashCommand['stateTone']
  visual: ChatSlashCommandStateVisual
} | null {
  const percent = state.usagePercent ?? state.autoCompactPercent
  const visual: ChatSlashCommandStateVisual = {
    kind: 'compactUsage',
    percent,
    status: state.status,
  }
  if (state.status === 'running') {
    return { label: 'Compacting', tone: 'neutral', visual }
  }
  if (percent !== null) {
    return {
      label: `Used ${percent}%`,
      tone:
        state.status === 'overLimit'
          ? 'danger'
          : state.status === 'nearLimit'
            ? 'warning'
            : state.status === 'compacted'
              ? 'success'
              : 'neutral',
      visual,
    }
  }
  if (state.status === 'compacted') {
    return { label: 'Compacted', tone: 'success', visual }
  }
  if (state.total.totalTokens > 0) {
    return {
      label: `${TOKEN_COUNT_FORMATTER.format(state.total.totalTokens)} tokens`,
      tone: 'neutral',
      visual,
    }
  }
  return null
}

function readDiffCommandState(
  state: ChatRuntimeDiffUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (!state.hasDiff) {
    return null
  }
  return { label: `${state.fileCount} files`, tone: 'neutral' }
}

function readFilesystemCommandState(
  state: ChatRuntimeFilesystemUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  return state.changedPathCount > 0
    ? { label: `${state.changedPathCount} changed`, tone: 'neutral' }
    : null
}

function readSkillsCommandState(
  state: ChatRuntimeSkillsUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.errorCount > 0) {
    return { label: `${state.errorCount} errors`, tone: 'warning' }
  }
  return { label: `${state.enabledCount} enabled`, tone: 'neutral' }
}

function readPluginCommandState(
  state: ChatRuntimePluginUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.errorCount > 0) {
    return { label: `${state.errorCount} errors`, tone: 'warning' }
  }
  return { label: `${state.enabledCount} enabled`, tone: 'neutral' }
}

function readSearchCommandState(
  state: ChatRuntimeSearchUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.fuzzySessionActive) {
    return { label: 'Searching', tone: 'neutral' }
  }
  return state.recentResultCount > 0
    ? { label: `${state.recentResultCount} results`, tone: 'neutral' }
    : null
}

function readCrewCommandState(
  state: ChatRuntimeCrewUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.failedCount > 0) {
    return { label: `${state.failedCount} failed`, tone: 'danger' }
  }
  if (state.activeCount > 0) {
    return { label: `${state.activeCount} active`, tone: 'neutral' }
  }
  if (state.collaborationModeCount > 0) {
    return { label: `${state.collaborationModeCount} modes`, tone: 'neutral' }
  }
  return null
}

function readUsageCommandState(
  state: ChatRuntimeUsageUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.rateLimitReachedType) {
    return { label: 'Limited', tone: 'danger' }
  }
  if (state.usedPercent !== null) {
    return {
      label: `${state.usedPercent}% used`,
      tone: state.usedPercent >= 90 ? 'warning' : 'neutral',
    }
  }
  return state.creditsBalance
    ? { label: state.creditsBalance, tone: state.hasCredits === false ? 'danger' : 'neutral' }
    : null
}

function readConfigCommandState(
  state: ChatRuntimeConfigUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  const label = state.approvalPolicy ?? state.sandboxMode ?? state.modelId
  return label ? { label: formatRuntimePhrase(label), tone: 'neutral' } : null
}

function readTerminalCommandState(
  state: ChatRuntimeTerminalUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.failedCount > 0) {
    return { label: `${state.failedCount} failed`, tone: 'danger' }
  }
  if (state.activeCount > 0) {
    return { label: `${state.activeCount} running`, tone: 'neutral' }
  }
  if (state.completedCount > 0) {
    return { label: `${state.completedCount} done`, tone: 'success' }
  }
  return null
}

function readApprovalsCommandState(
  state: ChatRuntimeApprovalsUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.pendingCount > 0) {
    return { label: `${state.pendingCount} pending`, tone: 'warning' }
  }
  if (state.deniedCount > 0) {
    return { label: `${state.deniedCount} denied`, tone: 'danger' }
  }
  if (state.approvedCount > 0) {
    return { label: `${state.approvedCount} approved`, tone: 'success' }
  }
  return null
}

function readAlertCommandState(
  state: ChatRuntimeAlertUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.errorCount > 0) {
    return { label: `${state.errorCount} errors`, tone: 'danger' }
  }
  if (state.warningCount > 0) {
    return { label: `${state.warningCount} warnings`, tone: 'warning' }
  }
  return null
}

function readGoalCommandState(state: ChatRuntimeGoalUiSlotState): {
  label: string
  tone?: ChatComposerSlashCommand['stateTone']
} {
  return {
    label: formatRuntimePhrase(state.status),
    tone:
      state.status === 'complete'
        ? 'success'
        : state.status === 'blocked'
          || state.status === 'usageLimited'
          || state.status === 'budgetLimited'
          ? 'danger'
          : state.status === 'paused'
            ? 'warning'
            : 'neutral',
  }
}

function readModelCommandState(
  state: ChatRuntimeModelUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  const label = state.modelLabel ?? state.modelId
  return label ? { label, tone: 'neutral' } : null
}

function readPlanCommandState(
  state: ChatRuntimePlanUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.inProgressCount > 0) {
    return { label: `${state.inProgressCount} active`, tone: 'neutral' }
  }
  if (state.pendingCount > 0) {
    return { label: `${state.pendingCount} pending`, tone: 'neutral' }
  }
  if (state.completedCount > 0) {
    return { label: `${state.completedCount} done`, tone: 'success' }
  }
  return null
}

function readToolActivityCommandState(
  state: ChatRuntimeToolActivityUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.failedCount > 0) {
    return { label: `${state.failedCount} failed`, tone: 'danger' }
  }
  if (state.activeCount > 0) {
    return { label: `${state.activeCount} running`, tone: 'neutral' }
  }
  if (state.completedCount > 0) {
    return { label: `${state.completedCount} done`, tone: 'success' }
  }
  return null
}

function readMcpCommandState(
  state: ChatRuntimeMcpUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.failedCount > 0) {
    return { label: `${state.failedCount} failed`, tone: 'danger' }
  }
  if (state.needsLoginCount > 0) {
    return { label: `${state.needsLoginCount} login`, tone: 'warning' }
  }
  if (state.serverCount > 0) {
    return { label: `${state.readyCount}/${state.serverCount} ready`, tone: 'neutral' }
  }
  return state.recentProgress ? { label: 'Active', tone: 'neutral' } : null
}

function readReasoningCommandState(
  state: ChatRuntimeReasoningUiSlotState,
): { label: string, tone?: ChatComposerSlashCommand['stateTone'] } | null {
  if (state.effort) {
    return { label: formatRuntimePhrase(state.effort), tone: 'neutral' }
  }
  if (state.supportedEfforts.length > 0) {
    return { label: `${state.supportedEfforts.length} modes`, tone: 'neutral' }
  }
  return null
}

function readStatusCommandState(state: ChatRuntimeStatusUiSlotState): {
  label: string
  tone?: ChatComposerSlashCommand['stateTone']
} {
  return {
    label:
      state.status === 'active' && state.activeFlags.length > 0
        ? state.activeFlags.map(formatRuntimePhrase).join(', ')
        : formatRuntimePhrase(state.status),
    tone:
      state.status === 'systemError'
        ? 'danger'
        : state.activeFlags.includes('waitingOnApproval')
          || state.activeFlags.includes('waitingOnUserInput')
          ? 'warning'
          : 'neutral',
  }
}

function readUserInputCommandState(state: ChatRuntimeUserInputUiSlotState): {
  label: string
  tone?: ChatComposerSlashCommand['stateTone']
} {
  return {
    label: state.questionCount === 1 ? '1 Question' : `${state.questionCount} Questions`,
    tone: 'warning',
  }
}

function formatRuntimePhrase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}
