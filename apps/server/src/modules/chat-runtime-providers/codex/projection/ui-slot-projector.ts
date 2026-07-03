/**
 * Output: Codex runtime UI slot descriptors and provider-owned runtime UI slot states.
 * Input: app-server capability manifest, provider snapshot state, and app-server config/list reads.
 * Position: Codex provider package owner for runtime UI slot projection.
 */

import {
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
  type RuntimeAlertUiSlotState,
  type RuntimeApprovalsUiSlotState,
  type RuntimeBackgroundTerminal,
  type RuntimeCompactUiSlotState,
  type RuntimeConfigUiSlotState,
  type RuntimeCrewAgentItem,
  type RuntimeCrewCallItem,
  type RuntimeCrewUiSlotState,
  type RuntimeDiffUiSlotState,
  type RuntimeFilesystemUiSlotState,
  type RuntimeMcpUiSlotState,
  type RuntimeModelUiSlotState,
  type RuntimePlanUiSlotState,
  type RuntimePluginUiSlotState,
  type RuntimeReasoningUiSlotState,
  type RuntimeSearchUiSlotState,
  type RuntimeSkillsUiSlotState,
  type RuntimeStatusUiSlotState,
  type RuntimeTerminalUiSlotState,
  type RuntimeToolActivityStatus,
  type RuntimeToolActivityUiSlotState,
  type RuntimeUiSlot,
  type RuntimeUiSlotState,
  type RuntimeUsageUiSlotState,
} from '../../../chat-runtime/runtime-provider-types'
import type { CodexAppServerCapabilityManifest } from '../app-server/capabilities'
import type { Thread } from '../app-server-protocol/v2/Thread'
import type { ThreadListResponse } from '../app-server-protocol/v2/ThreadListResponse'
import type { ThreadReadResponse } from '../app-server-protocol/v2/ThreadReadResponse'
import type { ThreadTurnsListResponse } from '../app-server-protocol/v2/ThreadTurnsListResponse'
import type { Turn } from '../app-server-protocol/v2/Turn'
import {
  isCodexGoalStatus,
  normalizeMcpAuthStatus,
  normalizeTokenUsageBreakdown,
  readCodexCompactSnapshot,
  readCodexProviderSnapshot,
  readConfigNumber,
  readNullableNumber,
  readNullablePercent,
  readPercent,
  readPositiveNumber
} from './state-projector'
import type {
  CodexAppServerClientLike,
  CodexAppsListResponse,
  CodexCollaborationModeListResponse,
  CodexCompactSnapshot,
  CodexConfigReadResponse,
  CodexConfigRequirementsReadResponse,
  CodexGoalSnapshot,
  CodexListMcpServerStatusResponse,
  CodexMcpServerSnapshot,
  CodexModelListResponse,
  CodexModelProviderCapabilitiesReadResponse,
  CodexPluginListResponse,
  CodexProviderSnapshot,
  CodexRateLimitsResponse,
  CodexSkillsListResponse,
  CodexThreadMetadata,
  CodexThreadStatus,
  ThreadGoalGetResponse
} from '../types'

const CODEX_CREW_TURNS_LIST_LIMIT = 50
const CODEX_CREW_THREAD_LIST_PAGE_SIZE = 100

interface CodexUiSlotDefinition extends Omit<RuntimeUiSlot, 'surfaces'> {
  surfaces?: RuntimeUiSlot['surfaces']
  requiredMethods?: string[]
  anyMethods?: string[]
  requiredServerRequests?: string[]
  anyServerRequests?: string[]
  requiredNotifications?: string[]
  anyNotifications?: string[]
}

const CODEX_UI_SLOT_DEFINITIONS: CodexUiSlotDefinition[] = [
  {
    id: 'codex:ide-context',
    name: 'ide-context',
    label: 'IDE context',
    description: 'Include current selection, open files, and IDE context.',
    argumentHint: '',
    aliases: ['context'],
    iconKey: 'ide-context',
    commandText: '/context ',
    surfaces: ['slashCommand'],
    requiredMethods: ['fuzzyFileSearch']
  },
  {
    id: 'codex:mcp',
    name: 'mcp',
    label: 'MCP',
    description: 'Show MCP server status.',
    argumentHint: '',
    iconKey: 'mcp',
    commandText: '/mcp ',
    anyMethods: [
      'mcpServerStatus/list',
      'mcpServer/tool/call',
      'mcpServer/resource/read',
      'mcpServer/oauth/login'
    ]
  },
  {
    id: 'codex:plan',
    name: 'plan',
    label: 'Plan',
    description: 'Show the current execution plan.',
    argumentHint: '',
    iconKey: 'plan',
    commandText: '/plan ',
    surfaces: ['composerState', 'runtimePanel'],
    anyNotifications: ['turn/plan/updated', 'item/plan/delta']
  },
  {
    id: 'codex:tool-activity',
    name: 'tools',
    label: 'Tool activity',
    description: 'Show recent runtime tool activity.',
    argumentHint: '',
    aliases: ['activity'],
    iconKey: 'tool-activity',
    commandText: '/tools ',
    anyNotifications: [
      'item/started',
      'item/completed',
      'serverRequest/resolved',
      'item/mcpToolCall/progress'
    ]
  },
  {
    id: 'codex:diff',
    name: 'diff',
    label: 'Diff',
    description: 'Show file changes for the current turn.',
    argumentHint: '',
    iconKey: 'diff',
    commandText: '/diff ',
    anyMethods: ['gitDiffToRemote'],
    anyNotifications: [
      'turn/diff/updated',
      'item/fileChange/patchUpdated',
      'item/fileChange/outputDelta'
    ]
  },
  {
    id: 'codex:terminal',
    name: 'terminal',
    label: 'Terminal',
    description: 'Show command and process activity.',
    argumentHint: '',
    aliases: ['shell'],
    iconKey: 'terminal',
    commandText: '/terminal ',
    surfaces: ['slashCommand', 'composerState', 'runtimePanel'],
    anyMethods: ['command/exec', 'process/spawn', 'thread/shellCommand'],
    anyNotifications: [
      'item/commandExecution/outputDelta',
      'item/commandExecution/terminalInteraction',
      'process/outputDelta',
      'process/exited'
    ]
  },
  {
    id: 'codex:approvals',
    name: 'approvals',
    label: 'Approvals',
    description: 'Show pending and recent approval reviews.',
    argumentHint: '',
    iconKey: 'approvals',
    commandText: '/approvals ',
    anyServerRequests: [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'applyPatchApproval',
      'execCommandApproval'
    ],
    anyNotifications: [
      'item/autoApprovalReview/started',
      'item/autoApprovalReview/completed',
      'serverRequest/pending',
      'serverRequest/handled',
      'serverRequest/resolved'
    ]
  },
  {
    id: 'codex:alerts',
    name: 'alerts',
    label: 'Alerts',
    description: 'Show recent warnings and recovery notices.',
    argumentHint: '',
    aliases: ['warnings'],
    iconKey: 'alert',
    commandText: '/alerts ',
    surfaces: ['runtimePanel'],
    anyNotifications: ['warning', 'guardianWarning', 'configWarning', 'deprecationNotice']
  },
  {
    id: 'codex:filesystem',
    name: 'files',
    label: 'Filesystem',
    description: 'Show recent filesystem activity.',
    argumentHint: '',
    aliases: ['filesystem'],
    iconKey: 'filesystem',
    commandText: '/files ',
    anyMethods: ['fs/readFile', 'fs/readDirectory', 'fs/watch', 'fs/getMetadata'],
    anyNotifications: ['fs/changed']
  },
  {
    id: 'codex:skills',
    name: 'skills',
    label: 'Skills',
    description: 'Show available runtime skills and load errors.',
    argumentHint: '',
    iconKey: 'skills',
    commandText: '/skills ',
    anyMethods: ['skills/list', 'skills/config/write', 'hooks/list'],
    anyNotifications: ['skills/changed']
  },
  {
    id: 'codex:plugin',
    name: 'plugins',
    label: 'Plugins',
    description: 'Show plugin, marketplace, and app availability.',
    argumentHint: '',
    aliases: ['apps'],
    iconKey: 'plugin',
    commandText: '/plugins ',
    anyMethods: ['plugin/list', 'plugin/read', 'app/list', 'marketplace/add'],
    anyNotifications: ['app/list/updated']
  },
  {
    id: 'codex:search',
    name: 'search',
    label: 'Search',
    description: 'Show search and file lookup activity.',
    argumentHint: '[query]',
    aliases: ['history'],
    iconKey: 'search',
    commandText: '/search ',
    anyMethods: ['thread/search', 'thread/read', 'thread/turns/list', 'fuzzyFileSearch'],
    anyNotifications: ['fuzzyFileSearch/sessionUpdated', 'fuzzyFileSearch/sessionCompleted']
  },
  {
    id: 'codex:quick-question',
    name: 'btw',
    label: 'Quick question',
    description: 'Ask a quick question without saving it to history.',
    argumentHint: '[question]',
    aliases: ['quick-question'],
    iconKey: 'quick-question',
    commandText: '/btw ',
    requiresSession: true,
    surfaces: ['slashCommand', 'composerState']
  },
  {
    id: 'codex:user-input',
    name: 'ask-user',
    label: 'Ask user',
    description: 'Answer a pending runtime question or MCP elicitation.',
    argumentHint: '',
    aliases: ['user-input', 'elicitation'],
    iconKey: 'user-input',
    commandText: '/ask-user ',
    surfaces: ['composerState', 'runtimePanel', 'streamEvidence'],
    anyServerRequests: ['item/tool/requestUserInput', 'mcpServer/elicitation/request']
  },
  {
    id: 'codex:crew',
    name: 'crew',
    label: 'Crew',
    description: 'Show delegation, review, and collaboration activity.',
    argumentHint: '',
    aliases: ['delegation'],
    iconKey: 'crew',
    commandText: '/crew ',
    surfaces: ['runtimePanel', 'streamEvidence'],
    anyMethods: ['review/start', 'collaborationMode/list', 'thread/fork'],
    anyNotifications: ['item/started', 'item/completed']
  },
  {
    id: 'codex:usage',
    name: 'usage',
    label: 'Usage',
    description: 'Show current usage and rate limit state.',
    argumentHint: '',
    iconKey: 'usage',
    commandText: '/usage ',
    commandAction: {
      kind: 'uiAction',
      actionId: RUNTIME_USAGE_COMMAND_ACTION_ID
    },
    requiresSession: true,
    surfaces: ['slashCommand', 'runtimePanel'],
    anyMethods: ['account/rateLimits/read'],
    anyNotifications: ['account/rateLimits/updated']
  },
  {
    id: 'codex:config',
    name: 'config',
    label: 'Config',
    description: 'Show active runtime configuration constraints.',
    argumentHint: '',
    iconKey: 'config',
    commandText: '/config ',
    surfaces: ['toolbarPicker', 'runtimePanel'],
    anyMethods: [
      'config/read',
      'configRequirements/read',
      'experimentalFeature/list',
      'permissionProfile/list'
    ],
    anyNotifications: [
      'configWarning',
      'thread/settings/updated',
      'model/rerouted',
      'model/verification'
    ]
  },
  {
    id: 'codex:personality',
    name: 'personality',
    label: 'Personality',
    description: 'Choose how Codex responds.',
    argumentHint: '',
    aliases: ['style'],
    iconKey: 'personality',
    commandText: '/personality ',
    surfaces: ['toolbarPicker'],
    requiredMethods: ['thread/settings/update']
  },
  {
    id: 'codex:review',
    name: 'review',
    label: 'Code review',
    description: 'Review unstaged changes or compare with a branch.',
    argumentHint: '[target]',
    aliases: ['code-review'],
    iconKey: 'code-review',
    commandText: '/review ',
    commandAction: {
      kind: 'uiAction',
      actionId: RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID
    },
    surfaces: ['slashCommand'],
    requiredMethods: ['review/start']
  },
  {
    id: 'codex:side-chat',
    name: 'side',
    label: 'Side chat',
    description: 'Start a side conversation from a temporary branch.',
    argumentHint: '',
    aliases: ['branch-chat'],
    iconKey: 'side-chat',
    commandText: '/side ',
    surfaces: ['runtimePanel'],
    requiredMethods: ['thread/fork']
  },
  {
    id: 'codex:compact',
    name: 'compact',
    label: 'Compact',
    description: 'Compact this conversation context.',
    argumentHint: '[instructions]',
    aliases: ['summarize'],
    iconKey: 'compact',
    commandText: '/compact ',
    commandAction: {
      kind: 'submitText',
      requiresEmptyComposer: true
    },
    surfaces: ['slashCommand', 'runtimePanel'],
    requiredMethods: ['thread/compact/start'],
    anyNotifications: ['thread/compacted']
  },
  {
    id: 'codex:feedback',
    name: 'feedback',
    label: 'Feedback',
    description: 'Send feedback about this chat.',
    argumentHint: '',
    iconKey: 'feedback',
    commandText: '/feedback ',
    surfaces: ['slashCommand'],
    requiredMethods: ['feedback/upload']
  },
  {
    id: 'codex:goal',
    name: 'goal',
    label: 'Goal',
    description: 'Set the active objective.',
    argumentHint: '<objective>',
    aliases: ['objective'],
    iconKey: 'goal',
    commandText: '/goal ',
    surfaces: ['slashCommand', 'composerState', 'runtimePanel'],
    requiredMethods: ['thread/goal/set', 'thread/goal/get', 'thread/goal/clear'],
    anyNotifications: ['thread/goal/updated', 'thread/goal/cleared']
  },
  {
    id: 'codex:reasoning',
    name: 'reasoning',
    label: 'Reasoning mode',
    description: 'Adjust reasoning effort.',
    argumentHint: '[low|medium|high]',
    aliases: ['thinking'],
    iconKey: 'reasoning',
    commandText: '/reasoning ',
    surfaces: ['toolbarPicker', 'runtimePanel'],
    requiredMethods: ['thread/settings/update']
  },
  {
    id: 'codex:model',
    name: 'model',
    label: 'Model',
    description: 'Switch the active model.',
    argumentHint: '[model]',
    iconKey: 'model',
    commandText: '/model ',
    surfaces: ['toolbarPicker', 'runtimePanel'],
    requiredMethods: ['model/list', 'modelProvider/capabilities/read']
  },
  {
    id: 'codex:status',
    name: 'status',
    label: 'Status',
    description: 'Switch or inspect context usage.',
    argumentHint: '',
    iconKey: 'status',
    commandText: '/status ',
    anyMethods: ['account/rateLimits/read', 'configRequirements/read'],
    anyNotifications: [
      'thread/status/changed',
      'thread/tokenUsage/updated',
      'thread/settings/updated'
    ]
  }
]

export function projectCodexUiSlots(manifest: CodexAppServerCapabilityManifest): RuntimeUiSlot[] {
  const methodNames = new Set(manifest.clientMethods.map((method) => method.method))
  const serverRequestNames = new Set(manifest.serverRequests.map((request) => request.method))
  const notificationNames = new Set(
    manifest.serverNotifications.map((notification) => notification.method)
  )

  return CODEX_UI_SLOT_DEFINITIONS.filter((slot) =>
    supportsSlot(slot, methodNames, serverRequestNames, notificationNames)
  ).map(
    ({
      requiredMethods: _requiredMethods,
      anyMethods: _anyMethods,
      requiredServerRequests: _requiredServerRequests,
      anyServerRequests: _anyServerRequests,
      requiredNotifications: _requiredNotifications,
      anyNotifications: _anyNotifications,
      surfaces,
      ...slot
    }) => ({
      ...slot,
      surfaces: surfaces ?? ['runtimePanel']
    })
  )
}

function supportsSlot(
  slot: CodexUiSlotDefinition,
  methodNames: Set<string>,
  serverRequestNames: Set<string>,
  notificationNames: Set<string>
): boolean {
  if (slot.requiredMethods?.some((method) => !methodNames.has(method))) {
    return false
  }
  if (slot.requiredServerRequests?.some((request) => !serverRequestNames.has(request))) {
    return false
  }
  if (slot.requiredNotifications?.some((notification) => !notificationNames.has(notification))) {
    return false
  }
  if (slot.anyMethods && !slot.anyMethods.some((method) => methodNames.has(method))) {
    return false
  }
  if (
    slot.anyServerRequests &&
    !slot.anyServerRequests.some((request) => serverRequestNames.has(request))
  ) {
    return false
  }
  if (
    slot.anyNotifications &&
    !slot.anyNotifications.some((notification) => notificationNames.has(notification))
  ) {
    return false
  }
  return true
}

export interface CodexUiSlotStateProjectionInput {
  client: CodexAppServerClientLike
  threadId: string
  providerStateSnapshot: string | null | undefined
  goal: ThreadGoalGetResponse['goal'] | undefined
  configResponse: CodexConfigReadResponse | null
  providerCapabilities: CodexModelProviderCapabilitiesReadResponse | null
  modelList: CodexModelListResponse | null
  mcpStatus: CodexListMcpServerStatusResponse | null
  rateLimits: CodexRateLimitsResponse | null
  configRequirements: CodexConfigRequirementsReadResponse | null
  skills: CodexSkillsListResponse | null
  plugins: CodexPluginListResponse | null
  apps: CodexAppsListResponse | null
  collaborationModes: CodexCollaborationModeListResponse | null
  backgroundTerminals: RuntimeBackgroundTerminal[]
}

export async function projectCodexUiSlotStates(
  input: CodexUiSlotStateProjectionInput
): Promise<RuntimeUiSlotState[]> {
  const snapshot = readCodexProviderSnapshot(input.providerStateSnapshot)
  const states: RuntimeUiSlotState[] = []
  const crewState = await readCodexCrewState(
    input.client,
    input.threadId,
    snapshot,
    input.collaborationModes
  )
  const slotStates = [
    projectCodexStatusState(input.threadId, snapshot),
    projectCodexModelState(
      input.threadId,
      snapshot,
      input.configResponse,
      input.providerCapabilities,
      input.modelList
    ),
    projectCodexReasoningState(input.threadId, snapshot, input.configResponse, input.modelList),
    projectCodexCompactState(
      input.threadId,
      readCodexCompactSnapshot(input.providerStateSnapshot),
      input.configResponse
    ),
    projectCodexPlanState(input.threadId, snapshot),
    projectCodexToolActivityState(input.threadId, snapshot),
    projectCodexMcpState(input.threadId, snapshot, input.mcpStatus),
    projectCodexDiffState(input.threadId, snapshot),
    projectCodexTerminalState(input.threadId, snapshot, input.backgroundTerminals),
    projectCodexApprovalsState(input.threadId, snapshot),
    projectCodexAlertState(input.threadId, snapshot),
    projectCodexFilesystemState(input.threadId, snapshot),
    projectCodexSkillsState(input.threadId, input.skills),
    projectCodexPluginState(input.threadId, input.plugins, input.apps),
    projectCodexSearchState(input.threadId, snapshot),
    crewState,
    projectCodexUsageState(input.threadId, snapshot, input.rateLimits),
    projectCodexConfigState(input.threadId, input.configResponse, input.configRequirements),
    projectCodexGoalState(readCodexGoalStateSource(input.goal, snapshot.codex?.goal ?? null))
  ]
  for (const state of slotStates) {
    if (state) {
      states.push(state)
    }
  }
  return states
}

function projectCodexGoalState(goal: ThreadGoalGetResponse['goal']): RuntimeUiSlotState | null {
  if (!goal?.threadId || !goal.objective || !isCodexGoalStatus(goal.status)) {
    return null
  }
  return {
    kind: 'goal',
    slotId: 'codex:goal',
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
    tokensUsed: typeof goal.tokensUsed === 'number' ? goal.tokensUsed : 0,
    timeUsedSeconds: typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : 0,
    createdAt: typeof goal.createdAt === 'number' ? goal.createdAt : 0,
    updatedAt: typeof goal.updatedAt === 'number' ? goal.updatedAt : 0
  }
}

function readCodexGoalStateSource(
  appServerGoal: ThreadGoalGetResponse['goal'] | undefined,
  snapshotGoal: CodexGoalSnapshot | null
): ThreadGoalGetResponse['goal'] {
  if (appServerGoal) {
    return appServerGoal
  }
  if (snapshotGoal?.status === 'complete') {
    return snapshotGoal
  }
  return appServerGoal ?? null
}

function projectCodexStatusState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeStatusUiSlotState | null {
  const status = snapshot.codex?.status
  if (!status || status.threadId !== threadId) {
    return null
  }
  const statusType = normalizeCodexThreadStatus(status.status)
  if (!statusType) {
    return null
  }
  return {
    kind: 'status',
    slotId: 'codex:status',
    threadId,
    status: statusType,
    activeFlags: Array.isArray(status.status.activeFlags)
      ? status.status.activeFlags.filter((flag) => typeof flag === 'string')
      : [],
    updatedAt: status.updatedAt
  }
}

function projectCodexModelState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  configResponse: CodexConfigReadResponse | null,
  providerCapabilities: CodexModelProviderCapabilitiesReadResponse | null,
  modelList: CodexModelListResponse | null
): RuntimeModelUiSlotState | null {
  const model = snapshot.codex?.model
  const modelId =
    model?.modelId ?? configResponse?.config?.model ?? snapshot.models?.currentModelId ?? null
  if (!model && !modelId) {
    return null
  }
  const modelInfo = findCodexModel(modelList, modelId)
  return {
    kind: 'model',
    slotId: 'codex:model',
    threadId,
    modelId,
    modelLabel: modelInfo?.displayName ?? modelInfo?.model ?? modelId,
    modelProvider: model?.modelProvider ?? configResponse?.config?.model_provider ?? null,
    serviceTier: model?.serviceTier ?? configResponse?.config?.service_tier ?? null,
    supportsImages:
      typeof providerCapabilities?.imageGeneration === 'boolean'
        ? providerCapabilities.imageGeneration
        : null,
    supportsWebSearch:
      typeof providerCapabilities?.webSearch === 'boolean' ? providerCapabilities.webSearch : null,
    supportsNamespaceTools:
      typeof providerCapabilities?.namespaceTools === 'boolean'
        ? providerCapabilities.namespaceTools
        : null,
    updatedAt: model?.updatedAt ?? 0
  }
}

function projectCodexReasoningState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  configResponse: CodexConfigReadResponse | null,
  modelList: CodexModelListResponse | null
): RuntimeReasoningUiSlotState | null {
  const reasoning = snapshot.codex?.reasoning
  const modelId =
    snapshot.codex?.model?.modelId ??
    configResponse?.config?.model ??
    snapshot.models?.currentModelId ??
    null
  const modelInfo = findCodexModel(modelList, modelId)
  const supportedEfforts = (modelInfo?.supportedReasoningEfforts ?? []).flatMap((option) =>
    typeof option.reasoningEffort === 'string'
      ? [
          {
            id: option.reasoningEffort,
            description: typeof option.description === 'string' ? option.description : ''
          }
        ]
      : []
  )
  const effort =
    reasoning?.effort ??
    configResponse?.config?.model_reasoning_effort ??
    modelInfo?.defaultReasoningEffort ??
    null
  const summary = reasoning?.summary ?? configResponse?.config?.model_reasoning_summary ?? null
  if (!reasoning && !effort && !summary && supportedEfforts.length === 0) {
    return null
  }
  return {
    kind: 'reasoning',
    slotId: 'codex:reasoning',
    threadId,
    effort,
    summary,
    supportedEfforts,
    updatedAt: reasoning?.updatedAt ?? 0
  }
}

function normalizeCodexThreadStatus(
  status: CodexThreadStatus
): RuntimeStatusUiSlotState['status'] | null {
  switch (status.type) {
    case 'notLoaded':
    case 'idle':
    case 'systemError':
    case 'active':
      return status.type
    default:
      return null
  }
}

function findCodexModel(
  modelList: CodexModelListResponse | null,
  modelId: string | null | undefined
) {
  if (!modelId) {
    return null
  }
  return modelList?.data?.find((model) => model.id === modelId || model.model === modelId) ?? null
}

function projectCodexCompactState(
  threadId: string,
  snapshot: CodexCompactSnapshot | null,
  configResponse: CodexConfigReadResponse | null
): RuntimeCompactUiSlotState | null {
  if (!snapshot || snapshot.threadId !== threadId) {
    return null
  }

  const total = normalizeTokenUsageBreakdown(snapshot.tokenUsage.total)
  const last = normalizeTokenUsageBreakdown(snapshot.tokenUsage.last)
  const modelContextWindow =
    readPositiveNumber(snapshot.tokenUsage.modelContextWindow) ??
    readConfigNumber(configResponse?.config?.model_context_window)
  const autoCompactTokenLimit = readConfigNumber(
    configResponse?.config?.model_auto_compact_token_limit
  )
  const currentWindowTokens = last.totalTokens > 0 ? last.totalTokens : total.totalTokens
  const usagePercent = modelContextWindow
    ? readPercent(currentWindowTokens, modelContextWindow)
    : null
  const autoCompactPercent = autoCompactTokenLimit
    ? readPercent(currentWindowTokens, autoCompactTokenLimit)
    : null
  const status = readCompactStatus({
    lifecycleStatus: snapshot.status ?? null,
    lastCompactedAt: snapshot.lastCompactedAt ?? null,
    usagePercent,
    autoCompactPercent
  })

  return {
    kind: 'compact',
    slotId: 'codex:compact',
    threadId: snapshot.threadId,
    turnId: snapshot.turnId,
    status,
    isCompactRelevant: status !== 'idle' || last.totalTokens > 0,
    total,
    last,
    modelContextWindow,
    autoCompactTokenLimit,
    usagePercent,
    autoCompactPercent,
    lastCompactedAt: snapshot.lastCompactedAt ?? null,
    compactionItemId: snapshot.compactionItemId ?? null,
    updatedAt: snapshot.updatedAt
  }
}

function projectCodexPlanState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimePlanUiSlotState | null {
  const plan = snapshot.codex?.plan
  if (!plan || plan.threadId !== threadId) {
    return null
  }
  const pendingCount = plan.steps.filter((step) => step.status === 'pending').length
  const inProgressCount = plan.steps.filter((step) => step.status === 'inProgress').length
  const completedCount = plan.steps.filter((step) => step.status === 'completed').length
  return {
    kind: 'plan',
    slotId: 'codex:plan',
    threadId,
    turnId: plan.turnId,
    explanation: plan.explanation,
    content: plan.content,
    steps: plan.steps,
    currentStep:
      plan.steps.find((step) => step.status === 'inProgress')?.step ??
      plan.steps.find((step) => step.status === 'pending')?.step ??
      null,
    pendingCount,
    inProgressCount,
    completedCount,
    updatedAt: plan.updatedAt
  }
}

function projectCodexToolActivityState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeToolActivityUiSlotState | null {
  const activity = snapshot.codex?.toolActivity
  if (!activity || activity.threadId !== threadId || activity.items.length === 0) {
    return null
  }
  return {
    kind: 'toolActivity',
    slotId: 'codex:tool-activity',
    threadId,
    turnId: activity.turnId,
    activeCount: activity.items.filter((item) => item.status === 'running').length,
    completedCount: activity.items.filter((item) => item.status === 'completed').length,
    failedCount: activity.items.filter((item) => item.status === 'failed').length,
    recentItems: activity.items,
    updatedAt: activity.updatedAt
  }
}

function projectCodexMcpState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  mcpStatus: CodexListMcpServerStatusResponse | null
): RuntimeMcpUiSlotState | null {
  const listedServers = projectMcpServersFromList(mcpStatus)
  const snapshotMcp = snapshot.codex?.mcp
  const serverMap = new Map<string, CodexMcpServerSnapshot>()
  for (const server of snapshotMcp?.servers ?? []) {
    serverMap.set(server.name, server)
  }
  for (const server of listedServers) {
    serverMap.set(server.name, mergeMcpListedServer(serverMap.get(server.name), server))
  }
  const servers = [...serverMap.values()]
  if (servers.length === 0 && !snapshotMcp?.recentProgress) {
    return null
  }
  return {
    kind: 'mcp',
    slotId: 'codex:mcp',
    threadId,
    serverCount: servers.length,
    readyCount: servers.filter((server) => server.status === 'ready').length,
    failedCount: servers.filter((server) => server.status === 'failed').length,
    needsLoginCount: servers.filter((server) => server.authStatus === 'notLoggedIn').length,
    recentProgress: snapshotMcp?.recentProgress ?? null,
    servers,
    updatedAt: Math.max(snapshotMcp?.updatedAt ?? 0, listedServers.length > 0 ? Date.now() : 0)
  }
}

function projectCodexDiffState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeDiffUiSlotState | null {
  const diff = snapshot.codex?.diff
  if (!diff || diff.threadId !== threadId || diff.files.length === 0) {
    return null
  }
  return {
    kind: 'diff',
    slotId: 'codex:diff',
    threadId,
    turnId: diff.turnId,
    fileCount: diff.files.length,
    addedLines: diff.files.reduce((count, file) => count + file.addedLines, 0),
    removedLines: diff.files.reduce((count, file) => count + file.removedLines, 0),
    hasDiff: diff.files.some((file) => file.addedLines > 0 || file.removedLines > 0),
    updatedAt: diff.updatedAt
  }
}

function projectCodexTerminalState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  backgroundTerminals: RuntimeBackgroundTerminal[]
): RuntimeTerminalUiSlotState | null {
  const terminal = snapshot.codex?.terminal
  if (
    (!terminal || terminal.threadId !== threadId || terminal.commands.length === 0) &&
    backgroundTerminals.length === 0
  ) {
    return null
  }
  const commands = terminal?.threadId === threadId ? terminal.commands : []
  const lastCommand = commands[0]
  return {
    kind: 'terminal',
    slotId: 'codex:terminal',
    threadId,
    turnId: terminal?.threadId === threadId ? terminal.turnId : null,
    activeCount: Math.max(
      commands.filter((command) => command.status === 'running').length,
      backgroundTerminals.length
    ),
    completedCount: commands.filter((command) => command.status === 'completed').length,
    failedCount: commands.filter((command) => command.status === 'failed').length,
    lastCommand: lastCommand?.command ?? null,
    lastOutputPreview: lastCommand?.outputPreview ?? null,
    backgroundTerminals,
    updatedAt: terminal?.updatedAt ?? Date.now()
  }
}

function projectCodexApprovalsState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeApprovalsUiSlotState | null {
  const approvals = snapshot.codex?.approvals
  if (!approvals || approvals.threadId !== threadId || approvals.items.length === 0) {
    return null
  }
  return {
    kind: 'approvals',
    slotId: 'codex:approvals',
    threadId,
    turnId: approvals.turnId,
    pendingCount: approvals.items.filter((item) => item.status === 'pending').length,
    approvedCount: approvals.items.filter((item) => item.status === 'approved').length,
    deniedCount: approvals.items.filter((item) => item.status === 'denied').length,
    recentItems: approvals.items,
    updatedAt: approvals.updatedAt
  }
}

function projectCodexAlertState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeAlertUiSlotState | null {
  const alert = snapshot.codex?.alert
  if (
    !alert ||
    (alert.threadId !== null && alert.threadId !== threadId) ||
    alert.items.length === 0
  ) {
    return null
  }
  return {
    kind: 'alert',
    slotId: 'codex:alerts',
    threadId: alert.threadId,
    warningCount: alert.items.filter((item) => item.severity === 'warning').length,
    errorCount: alert.items.filter((item) => item.severity === 'error').length,
    recentItems: alert.items,
    updatedAt: alert.updatedAt
  }
}

function projectCodexFilesystemState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeFilesystemUiSlotState | null {
  const filesystem = snapshot.codex?.filesystem
  if (!filesystem || filesystem.threadId !== threadId || filesystem.recentPaths.length === 0) {
    return null
  }
  return {
    kind: 'filesystem',
    slotId: 'codex:filesystem',
    threadId,
    changedPathCount: filesystem.recentPaths.length,
    recentPaths: filesystem.recentPaths,
    updatedAt: filesystem.updatedAt
  }
}

function projectCodexSkillsState(
  threadId: string,
  response: CodexSkillsListResponse | null
): RuntimeSkillsUiSlotState | null {
  const entries = response?.data ?? []
  if (entries.length === 0) {
    return null
  }
  const skills = entries.flatMap((entry) => entry.skills ?? [])
  return {
    kind: 'skills',
    slotId: 'codex:skills',
    threadId,
    enabledCount: skills.filter((skill) => skill.enabled !== false).length,
    disabledCount: skills.filter((skill) => skill.enabled === false).length,
    errorCount: entries.reduce((count, entry) => count + (entry.errors?.length ?? 0), 0),
    roots: entries.flatMap((entry) => (typeof entry.cwd === 'string' ? [entry.cwd] : [])),
    updatedAt: Date.now()
  }
}

function projectCodexPluginState(
  threadId: string,
  pluginsResponse: CodexPluginListResponse | null,
  appsResponse: CodexAppsListResponse | null
): RuntimePluginUiSlotState | null {
  const marketplaces = pluginsResponse?.marketplaces ?? []
  const plugins = marketplaces.flatMap((marketplace) => marketplace.plugins ?? [])
  const apps = appsResponse?.data ?? []
  if (marketplaces.length === 0 && apps.length === 0) {
    return null
  }
  return {
    kind: 'plugin',
    slotId: 'codex:plugin',
    threadId,
    installedCount: plugins.filter((plugin) => plugin.installed === true).length,
    enabledCount: plugins.filter((plugin) => plugin.enabled === true).length,
    appCount: apps.filter((app) => app.isAccessible !== false && app.isEnabled !== false).length,
    marketplaceCount: marketplaces.length,
    errorCount: pluginsResponse?.marketplaceLoadErrors?.length ?? 0,
    updatedAt: Date.now()
  }
}

function projectCodexSearchState(
  threadId: string,
  snapshot: CodexProviderSnapshot
): RuntimeSearchUiSlotState | null {
  const search = snapshot.codex?.search
  if (!search || search.threadId !== threadId) {
    return null
  }
  return {
    kind: 'search',
    slotId: 'codex:search',
    threadId,
    recentResultCount: search.recentResultCount,
    recentQuery: search.recentQuery,
    fuzzySessionActive: search.fuzzySessionActive,
    updatedAt: search.updatedAt
  }
}

async function readCodexCrewState(
  client: CodexAppServerClientLike,
  parentThreadId: string,
  snapshot: CodexProviderSnapshot,
  collaborationModes: CodexCollaborationModeListResponse | null
): Promise<RuntimeCrewUiSlotState | null> {
  const listedThreads = await listCodexCrewThreads(client, parentThreadId).catch(() => [])
  const turns = await listRecentCodexCrewTurns(client, parentThreadId).catch(() => [])
  const calls = mergeCodexCrewCalls(
    projectCodexCrewCallsFromTurns(parentThreadId, turns),
    projectCodexCrewCallsFromSnapshot(snapshot)
  )
  const listedMetadata = new Map(
    listedThreads.flatMap((thread) => {
      const metadata = readCodexThreadMetadataFromThread(thread.id, thread)
      return metadata ? [[metadata.id, metadata] as const] : []
    })
  )
  const missingCallThreadIds = readCrewReceiverThreadIdsFromCalls(parentThreadId, calls).filter(
    (threadId) => !listedMetadata.has(threadId)
  )
  const snapshotThreadIds = readCrewReceiverThreadIdsFromSnapshot(parentThreadId, snapshot).filter(
    (threadId) => !listedMetadata.has(threadId)
  )
  const fetchedMetadata = await readCrewThreadMetadata(
    client,
    uniqueStrings([...missingCallThreadIds, ...snapshotThreadIds])
  )
  const threadMetadata = new Map([...listedMetadata, ...fetchedMetadata])
  const listedAgents = listedThreads.map((thread) =>
    readCrewAgentFromThread(thread, threadMetadata)
  )
  return projectCodexCrewStateFromCalls(
    parentThreadId,
    calls,
    collaborationModes,
    threadMetadata,
    listedAgents
  )
}

async function listCodexCrewThreads(
  client: CodexAppServerClientLike,
  parentThreadId: string
): Promise<Thread[]> {
  const parent = (await client.request('thread/read', {
    threadId: parentThreadId,
    includeTurns: false
  })) as ThreadReadResponse
  const threads: Thread[] = []
  const seenThreadIds = new Set<string>()
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const response = (await client.request('thread/list', {
      cursor,
      limit: CODEX_CREW_THREAD_LIST_PAGE_SIZE,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: ['subAgentThreadSpawn'],
      archived: false
    })) as ThreadListResponse
    for (const thread of response.data ?? []) {
      if (
        !codexThreadBelongsToRuntimeParent(parent.thread, thread) ||
        seenThreadIds.has(thread.id)
      ) {
        continue
      }
      seenThreadIds.add(thread.id)
      threads.push(thread)
    }
    const nextCursor = response.nextCursor ?? null
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)

  return threads
}

async function listRecentCodexCrewTurns(
  client: CodexAppServerClientLike,
  threadId: string
): Promise<Turn[]> {
  const response = (await client.request('thread/turns/list', {
    threadId,
    limit: CODEX_CREW_TURNS_LIST_LIMIT,
    sortDirection: 'desc',
    itemsView: 'full'
  })) as ThreadTurnsListResponse
  return Array.isArray(response.data) ? response.data : []
}

async function readCrewThreadMetadata(
  client: CodexAppServerClientLike,
  threadIds: string[]
): Promise<Map<string, CodexThreadMetadata>> {
  if (threadIds.length === 0) {
    return new Map()
  }

  const results = await Promise.allSettled(
    threadIds.map(async (threadId) => {
      const response = (await client.request('thread/read', {
        threadId,
        includeTurns: false
      })) as ThreadReadResponse
      return readCodexThreadMetadata(threadId, response)
    })
  )

  const metadata = new Map<string, CodexThreadMetadata>()
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      metadata.set(result.value.id, result.value)
    }
  }
  return metadata
}

function readCrewReceiverThreadIdsFromSnapshot(
  parentThreadId: string,
  snapshot: CodexProviderSnapshot
): string[] {
  const ids = new Set<string>()
  for (const item of snapshot.codex?.toolActivity?.items ?? []) {
    if (item.type !== 'collabAgentToolCall') {
      continue
    }
    for (const threadId of item.receiverThreadIds ?? []) {
      if (threadId && threadId !== parentThreadId) {
        ids.add(threadId)
      }
    }
    for (const threadId of Object.keys(item.agentsStates ?? {})) {
      if (threadId && threadId !== parentThreadId) {
        ids.add(threadId)
      }
    }
  }
  return Array.from(ids).slice(0, 12)
}

function readCrewReceiverThreadIdsFromCalls(
  parentThreadId: string,
  calls: RuntimeCrewCallItem[]
): string[] {
  const ids = new Set<string>()
  for (const call of calls) {
    for (const threadId of call.receiverThreadIds) {
      if (threadId && threadId !== parentThreadId) {
        ids.add(threadId)
      }
    }
    for (const agent of call.agents) {
      if (agent.threadId && agent.threadId !== parentThreadId) {
        ids.add(agent.threadId)
      }
    }
  }
  return Array.from(ids).slice(0, 24)
}

function readCodexThreadMetadata(
  fallbackThreadId: string,
  response: ThreadReadResponse
): CodexThreadMetadata | null {
  const thread = response.thread as Partial<ThreadReadResponse['thread']> | undefined
  return readCodexThreadMetadataFromThread(fallbackThreadId, thread)
}

function readCodexThreadMetadataFromThread(
  fallbackThreadId: string,
  thread: Partial<Thread> | undefined
): CodexThreadMetadata | null {
  if (!thread) {
    return null
  }
  const id = typeof thread.id === 'string' ? thread.id : fallbackThreadId
  return {
    id,
    name: typeof thread.name === 'string' ? thread.name : null,
    preview: typeof thread.preview === 'string' ? thread.preview : null,
    modelProvider: typeof thread.modelProvider === 'string' ? thread.modelProvider : null,
    agentNickname: typeof thread.agentNickname === 'string' ? thread.agentNickname : null,
    agentRole: typeof thread.agentRole === 'string' ? thread.agentRole : null
  }
}

function readCrewAgentFromThread(
  thread: Thread,
  threadMetadata: Map<string, CodexThreadMetadata>
): RuntimeCrewAgentItem {
  const metadata = threadMetadata.get(thread.id)
  return {
    threadId: thread.id,
    status: readThreadStatusType(thread.status),
    message: null,
    name: metadata?.name ?? null,
    preview: metadata?.preview ?? null,
    modelProvider: metadata?.modelProvider ?? null,
    agentNickname: metadata?.agentNickname ?? null,
    agentRole: metadata?.agentRole ?? null
  }
}

function projectCodexCrewCallsFromTurns(
  parentThreadId: string,
  turns: Turn[]
): RuntimeCrewCallItem[] {
  const calls: RuntimeCrewCallItem[] = []
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      if (item.type !== 'collabAgentToolCall') {
        continue
      }
      if (item.senderThreadId && item.senderThreadId !== parentThreadId) {
        continue
      }
      const receiverThreadIds = Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter((threadId) => typeof threadId === 'string')
        : []
      const agentsStates = item.agentsStates ?? {}
      calls.push({
        id: item.id,
        tool: item.tool ?? 'Agent',
        status: normalizeCollabToolCallStatus(item.status),
        senderThreadId: item.senderThreadId ?? null,
        receiverThreadIds,
        prompt: typeof item.prompt === 'string' ? item.prompt : null,
        model: typeof item.model === 'string' ? item.model : null,
        reasoningEffort: typeof item.reasoningEffort === 'string' ? item.reasoningEffort : null,
        agents: readCrewAgents(receiverThreadIds, agentsStates, new Map()),
        startedAt: typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : null,
        completedAt: typeof turn.completedAt === 'number' ? turn.completedAt * 1000 : null
      })
    }
  }
  return calls.slice(0, 24)
}

function projectCodexCrewStateFromSnapshot(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  collaborationModes: CodexCollaborationModeListResponse | null,
  threadMetadata: Map<string, CodexThreadMetadata>
): RuntimeCrewUiSlotState | null {
  const activity = snapshot.codex?.toolActivity
  const calls = projectCodexCrewCallsFromSnapshot(snapshot)
  const recentItems = (activity?.items ?? []).filter((item) => item.type === 'collabAgentToolCall')
  return projectCodexCrewStateFromCalls(
    threadId,
    calls,
    collaborationModes,
    threadMetadata,
    [],
    activity?.updatedAt ?? 0,
    recentItems
  )
}

function projectCodexCrewCallsFromSnapshot(snapshot: CodexProviderSnapshot): RuntimeCrewCallItem[] {
  return (snapshot.codex?.toolActivity?.items ?? [])
    .filter((item) => item.type === 'collabAgentToolCall')
    .map((item) => ({
      id: item.id,
      tool: item.label,
      status: item.status,
      senderThreadId: item.senderThreadId ?? null,
      receiverThreadIds: item.receiverThreadIds ?? [],
      prompt: item.prompt ?? null,
      model: item.model ?? null,
      reasoningEffort: item.reasoningEffort ?? null,
      agents: readCrewAgents(item.receiverThreadIds ?? [], item.agentsStates ?? {}, new Map()),
      startedAt: item.startedAt,
      completedAt: item.completedAt
    }))
}

function mergeCodexCrewCalls(
  primaryCalls: RuntimeCrewCallItem[],
  fallbackCalls: RuntimeCrewCallItem[]
): RuntimeCrewCallItem[] {
  const seen = new Set<string>()
  const calls: RuntimeCrewCallItem[] = []
  for (const call of [...primaryCalls, ...fallbackCalls]) {
    if (seen.has(call.id)) {
      continue
    }
    seen.add(call.id)
    calls.push(call)
  }
  return calls.slice(0, 24)
}

function projectCodexCrewStateFromCalls(
  threadId: string,
  calls: RuntimeCrewCallItem[],
  collaborationModes: CodexCollaborationModeListResponse | null,
  threadMetadata: Map<string, CodexThreadMetadata>,
  listedAgents: RuntimeCrewAgentItem[] = [],
  fallbackUpdatedAt = 0,
  recentItems = calls.map((call) => ({
    id: call.id,
    type: 'collabAgentToolCall',
    label: call.tool,
    status: call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt
  }))
): RuntimeCrewUiSlotState | null {
  const modes = projectCodexCrewCollaborationModes(collaborationModes)
  const hydratedCalls = calls.map((call) => ({
    ...call,
    agents: readCrewAgents(
      call.receiverThreadIds,
      Object.fromEntries(
        call.agents.map((agent) => [
          agent.threadId,
          { status: agent.status, message: agent.message }
        ])
      ),
      threadMetadata
    )
  }))
  if (calls.length === 0 && modes.length === 0 && listedAgents.length === 0) {
    return null
  }
  const agents = mergeCrewAgents([...listedAgents, ...hydratedCalls.flatMap((call) => call.agents)])
  return {
    kind: 'crew',
    slotId: 'codex:crew',
    threadId,
    activeCount: agents.filter((agent) => isActiveCrewAgentStatus(agent.status)).length,
    completedCount: agents.filter((agent) => isCompletedCrewAgentStatus(agent.status)).length,
    failedCount: agents.filter((agent) => isFailedCrewAgentStatus(agent.status)).length,
    recentItems: recentItems.slice(0, 12),
    agents,
    collaborationModeCount: modes.length,
    collaborationModes: modes,
    calls: hydratedCalls,
    updatedAt: Math.max(fallbackUpdatedAt, modes.length > 0 || calls.length > 0 ? Date.now() : 0)
  }
}

function projectCodexCrewCollaborationModes(
  collaborationModes: CodexCollaborationModeListResponse | null
): RuntimeCrewUiSlotState['collaborationModes'] {
  return (collaborationModes?.data ?? []).flatMap((mode) => {
    const name = mode.name ?? mode.id
    if (!name) {
      return []
    }
    return [
      {
        name,
        mode: mode.mode ?? null,
        model: mode.model ?? null,
        reasoningEffort: mode.reasoning_effort ?? null
      }
    ]
  })
}

function normalizeCollabToolCallStatus(status: unknown): RuntimeToolActivityStatus {
  if (status === 'failed') {
    return 'failed'
  }
  if (status === 'completed') {
    return 'completed'
  }
  return 'running'
}

function isActiveCrewAgentStatus(status: string | null): boolean {
  return status === 'pendingInit' || status === 'running' || status === 'active'
}

function isCompletedCrewAgentStatus(status: string | null): boolean {
  return status === 'completed' || status === 'shutdown'
}

function isFailedCrewAgentStatus(status: string | null): boolean {
  return status === 'errored' || status === 'interrupted' || status === 'notFound'
}

function readCrewAgents(
  receiverThreadIds: string[],
  agentsStates: Record<string, { status?: string | null; message?: string | null } | undefined>,
  threadMetadata: Map<string, CodexThreadMetadata>
): RuntimeCrewAgentItem[] {
  const ids = new Set([...receiverThreadIds, ...Object.keys(agentsStates)])
  return Array.from(ids, (threadId) => {
    const metadata = threadMetadata.get(threadId)
    return {
      threadId,
      status: agentsStates[threadId]?.status ?? null,
      message: agentsStates[threadId]?.message ?? null,
      name: metadata?.name ?? null,
      preview: metadata?.preview ?? null,
      modelProvider: metadata?.modelProvider ?? null,
      agentNickname: metadata?.agentNickname ?? null,
      agentRole: metadata?.agentRole ?? null
    }
  })
}

function mergeCrewAgents(agents: RuntimeCrewAgentItem[]): RuntimeCrewAgentItem[] {
  const byThreadId = new Map<string, RuntimeCrewAgentItem>()
  for (const agent of agents) {
    const existing = byThreadId.get(agent.threadId)
    byThreadId.set(agent.threadId, existing ? mergeCrewAgent(existing, agent) : agent)
  }
  return Array.from(byThreadId.values())
}

function mergeCrewAgent(
  left: RuntimeCrewAgentItem,
  right: RuntimeCrewAgentItem
): RuntimeCrewAgentItem {
  return {
    threadId: right.threadId,
    status: right.status ?? left.status,
    message: right.message ?? left.message,
    name: right.name ?? left.name,
    preview: right.preview ?? left.preview,
    modelProvider: right.modelProvider ?? left.modelProvider,
    agentNickname: right.agentNickname ?? left.agentNickname,
    agentRole: right.agentRole ?? left.agentRole
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function readThreadStatusType(status: Thread['status']): string {
  return typeof status === 'object' && status !== null && 'type' in status
    ? String(status.type)
    : 'unknown'
}

function codexThreadBelongsToRuntimeParent(parentThread: Thread, thread: Thread): boolean {
  if (thread.parentThreadId === parentThread.id) {
    return true
  }
  return readCodexThreadSpawnParentThreadId(thread.source) === parentThread.id
}

function readCodexThreadSpawnParentThreadId(source: Thread['source']): string | null {
  if (!source || typeof source !== 'object' || !('subAgent' in source)) {
    return null
  }
  const subAgentSource = source.subAgent
  if (
    !subAgentSource ||
    typeof subAgentSource !== 'object' ||
    !('thread_spawn' in subAgentSource)
  ) {
    return null
  }
  const spawn = subAgentSource.thread_spawn
  if (!spawn || typeof spawn !== 'object') {
    return null
  }
  const parentThreadId = (spawn as { parent_thread_id?: unknown }).parent_thread_id
  return typeof parentThreadId === 'string' && parentThreadId.length > 0 ? parentThreadId : null
}

function projectCodexUsageState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  response: CodexRateLimitsResponse | null
): RuntimeUsageUiSlotState | null {
  const rateLimits = response?.rateLimits ?? snapshot.codex?.usage?.rateLimits ?? null
  if (!rateLimits) {
    return null
  }
  return {
    kind: 'usage',
    slotId: 'codex:usage',
    threadId,
    limitName: typeof rateLimits.limitName === 'string' ? rateLimits.limitName : null,
    usedPercent: readNullablePercent(rateLimits.primary?.usedPercent),
    primaryWindowDurationMins: readNullableNumber(rateLimits.primary?.windowDurationMins),
    primaryResetsAt: readNullableNumber(rateLimits.primary?.resetsAt),
    secondaryUsedPercent: readNullablePercent(rateLimits.secondary?.usedPercent),
    secondaryWindowDurationMins: readNullableNumber(rateLimits.secondary?.windowDurationMins),
    secondaryResetsAt: readNullableNumber(rateLimits.secondary?.resetsAt),
    creditsBalance:
      typeof rateLimits.credits?.balance === 'string' ? rateLimits.credits.balance : null,
    hasCredits:
      typeof rateLimits.credits?.hasCredits === 'boolean' ? rateLimits.credits.hasCredits : null,
    rateLimitReachedType:
      typeof rateLimits.rateLimitReachedType === 'string' ? rateLimits.rateLimitReachedType : null,
    planType: typeof rateLimits.planType === 'string' ? rateLimits.planType : null,
    updatedAt: snapshot.codex?.usage?.updatedAt ?? Date.now()
  }
}

function projectCodexConfigState(
  threadId: string,
  configResponse: CodexConfigReadResponse | null,
  requirementsResponse: CodexConfigRequirementsReadResponse | null
): RuntimeConfigUiSlotState | null {
  const config = configResponse?.config
  const requirements = requirementsResponse?.requirements
  if (!config && !requirements) {
    return null
  }
  return {
    kind: 'config',
    slotId: 'codex:config',
    threadId,
    modelId: config?.model ?? null,
    approvalPolicy: config?.approval_policy ?? null,
    sandboxMode: config?.sandbox_mode ?? null,
    allowedApprovalPolicyCount: Array.isArray(requirements?.allowedApprovalPolicies)
      ? requirements.allowedApprovalPolicies.length
      : null,
    allowedSandboxModeCount: Array.isArray(requirements?.allowedSandboxModes)
      ? requirements.allowedSandboxModes.length
      : null,
    featureRequirementCount: requirements?.featureRequirements
      ? Object.keys(requirements.featureRequirements).length
      : null,
    webSearchModeCount: Array.isArray(requirements?.allowedWebSearchModes)
      ? requirements.allowedWebSearchModes.length
      : null,
    updatedAt: Date.now()
  }
}

function mergeMcpListedServer(
  existing: CodexMcpServerSnapshot | undefined,
  listed: CodexMcpServerSnapshot
): CodexMcpServerSnapshot {
  if (!existing) {
    return listed
  }
  return {
    ...listed,
    status: existing.status !== 'unknown' ? existing.status : listed.status,
    authStatus: existing.authStatus !== 'unknown' ? existing.authStatus : listed.authStatus,
    error: existing.error ?? listed.error
  }
}

function readCompactStatus(input: {
  lifecycleStatus: RuntimeCompactUiSlotState['status'] | null
  lastCompactedAt: number | null
  usagePercent: number | null
  autoCompactPercent: number | null
}): RuntimeCompactUiSlotState['status'] {
  if (input.lifecycleStatus === 'running') {
    return 'running'
  }
  if (input.lifecycleStatus === 'compacted') {
    return 'compacted'
  }
  if (input.lastCompactedAt) {
    return 'compacted'
  }
  const percent = input.autoCompactPercent ?? input.usagePercent
  if (percent === null) {
    return 'idle'
  }
  if (percent >= 100) {
    return 'overLimit'
  }
  if (percent >= 80) {
    return 'nearLimit'
  }
  return 'idle'
}

function projectMcpServersFromList(
  response: CodexListMcpServerStatusResponse | null
): CodexMcpServerSnapshot[] {
  return (response?.data ?? []).flatMap((server) => {
    if (typeof server.name !== 'string') {
      return []
    }
    return [
      {
        name: server.name,
        status: 'ready',
        authStatus: normalizeMcpAuthStatus(server.authStatus),
        toolCount: server.tools ? Object.keys(server.tools).length : 0,
        resourceCount: (server.resources?.length ?? 0) + (server.resourceTemplates?.length ?? 0),
        error: null
      }
    ]
  })
}
