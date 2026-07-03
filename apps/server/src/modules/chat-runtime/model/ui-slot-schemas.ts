import { t } from 'elysia'

const runtimeUiSlotCommandActionSchema = t.Union([
  t.Object({
    kind: t.Literal('insertText'),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal('submitText'),
    requiresEmptyComposer: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal('uiAction'),
    actionId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
])

export const runtimeUiSlotSchema = t.Object({
  id: t.String(),
  name: t.String(),
  label: t.String(),
  description: t.String(),
  argumentHint: t.String(),
  aliases: t.Optional(t.Array(t.String())),
  iconKey: t.Optional(
    t.Union([
      t.Literal('alert'),
      t.Literal('approvals'),
      t.Literal('code-review'),
      t.Literal('compact'),
      t.Literal('config'),
      t.Literal('diff'),
      t.Literal('feedback'),
      t.Literal('filesystem'),
      t.Literal('goal'),
      t.Literal('crew'),
      t.Literal('ide-context'),
      t.Literal('mcp'),
      t.Literal('model'),
      t.Literal('personality'),
      t.Literal('plugin'),
      t.Literal('plan'),
      t.Literal('progress'),
      t.Literal('quick-question'),
      t.Literal('user-input'),
      t.Literal('reasoning'),
      t.Literal('search'),
      t.Literal('side-chat'),
      t.Literal('skills'),
      t.Literal('status'),
      t.Literal('terminal'),
      t.Literal('tool-activity'),
      t.Literal('usage')
    ])
  ),
  commandText: t.Optional(t.String()),
  commandAction: t.Optional(runtimeUiSlotCommandActionSchema),
  requiresSession: t.Optional(t.Boolean()),
  surfaces: t.Array(
    t.Union([
      t.Literal('slashCommand'),
      t.Literal('toolbarPicker'),
      t.Literal('composerState'),
      t.Literal('messageInline'),
      t.Literal('runtimePanel'),
      t.Literal('streamEvidence'),
      t.Literal('recordOnly')
    ])
  )
})

export const runtimeGoalStatusSchema = t.Union([
  t.Literal('active'),
  t.Literal('paused'),
  t.Literal('blocked'),
  t.Literal('usageLimited'),
  t.Literal('budgetLimited'),
  t.Literal('complete')
])

export const runtimeGoalUiSlotStateSchema = t.Object({
  kind: t.Literal('goal'),
  slotId: t.String(),
  threadId: t.String(),
  objective: t.String(),
  status: runtimeGoalStatusSchema,
  tokenBudget: t.Union([t.Number(), t.Null()]),
  tokensUsed: t.Number(),
  timeUsedSeconds: t.Number(),
  createdAt: t.Number(),
  updatedAt: t.Number()
})

export const runtimeTokenUsageBreakdownSchema = t.Object({
  totalTokens: t.Number(),
  inputTokens: t.Number(),
  cachedInputTokens: t.Number(),
  outputTokens: t.Number(),
  reasoningOutputTokens: t.Number()
})

export const runtimeCompactStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('running'),
  t.Literal('nearLimit'),
  t.Literal('overLimit'),
  t.Literal('compacted')
])

export const runtimeCompactUiSlotStateSchema = t.Object({
  kind: t.Literal('compact'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  status: runtimeCompactStatusSchema,
  isCompactRelevant: t.Boolean(),
  total: runtimeTokenUsageBreakdownSchema,
  last: runtimeTokenUsageBreakdownSchema,
  modelContextWindow: t.Union([t.Number(), t.Null()]),
  autoCompactTokenLimit: t.Union([t.Number(), t.Null()]),
  usagePercent: t.Union([t.Number(), t.Null()]),
  autoCompactPercent: t.Union([t.Number(), t.Null()]),
  lastCompactedAt: t.Union([t.Number(), t.Null()]),
  compactionItemId: t.Union([t.String(), t.Null()]),
  updatedAt: t.Number()
})

export const runtimeStatusUiSlotStateSchema = t.Object({
  kind: t.Literal('status'),
  slotId: t.String(),
  threadId: t.String(),
  status: t.Union([
    t.Literal('notLoaded'),
    t.Literal('idle'),
    t.Literal('systemError'),
    t.Literal('active')
  ]),
  activeFlags: t.Array(t.String()),
  updatedAt: t.Number()
})

export const runtimeModelUiSlotStateSchema = t.Object({
  kind: t.Literal('model'),
  slotId: t.String(),
  threadId: t.String(),
  modelId: t.Union([t.String(), t.Null()]),
  modelLabel: t.Union([t.String(), t.Null()]),
  modelProvider: t.Union([t.String(), t.Null()]),
  serviceTier: t.Union([t.String(), t.Null()]),
  supportsImages: t.Union([t.Boolean(), t.Null()]),
  supportsWebSearch: t.Union([t.Boolean(), t.Null()]),
  supportsNamespaceTools: t.Union([t.Boolean(), t.Null()]),
  updatedAt: t.Number()
})

export const runtimeReasoningUiSlotStateSchema = t.Object({
  kind: t.Literal('reasoning'),
  slotId: t.String(),
  threadId: t.String(),
  effort: t.Union([t.String(), t.Null()]),
  summary: t.Union([t.String(), t.Null()]),
  supportedEfforts: t.Array(
    t.Object({
      id: t.String(),
      description: t.String()
    })
  ),
  updatedAt: t.Number()
})

export const runtimePlanStepStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('inProgress'),
  t.Literal('completed')
])

export const runtimePlanUiSlotStateSchema = t.Object({
  kind: t.Literal('plan'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  explanation: t.Union([t.String(), t.Null()]),
  content: t.Union([t.String(), t.Null()]),
  steps: t.Array(
    t.Object({
      step: t.String(),
      status: runtimePlanStepStatusSchema
    })
  ),
  currentStep: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  inProgressCount: t.Number(),
  completedCount: t.Number(),
  updatedAt: t.Number()
})

export const runtimeProgressUiSlotStateSchema = t.Object({
  kind: t.Literal('progress'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  source: t.String(),
  items: t.Array(
    t.Object({
      id: t.Union([t.String(), t.Null()]),
      label: t.String(),
      status: runtimePlanStepStatusSchema,
      sourceStatus: t.Union([t.String(), t.Null()])
    })
  ),
  currentItem: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  inProgressCount: t.Number(),
  completedCount: t.Number(),
  updatedAt: t.Number()
})

export const runtimeUserInputQuestionSchema = t.Object({
  id: t.String(),
  header: t.String(),
  question: t.String(),
  isOther: t.Boolean(),
  isSecret: t.Boolean(),
  multiSelect: t.Boolean(),
  options: t.Union([
    t.Array(
      t.Object({
        label: t.String(),
        description: t.String()
      })
    ),
    t.Null()
  ])
})

export const runtimeUserInputUiSlotStateSchema = t.Object({
  kind: t.Literal('userInput'),
  slotId: t.String(),
  threadId: t.Union([t.String(), t.Null()]),
  runId: t.String(),
  requestId: t.String(),
  providerMethod: t.String(),
  toolCallId: t.String(),
  questionCount: t.Number(),
  questions: t.Array(runtimeUserInputQuestionSchema),
  createdAt: t.Number(),
  updatedAt: t.Number()
})

export const runtimeToolActivityStatusSchema = t.Union([
  t.Literal('running'),
  t.Literal('completed'),
  t.Literal('failed')
])

export const runtimeToolActivityUiSlotStateSchema = t.Object({
  kind: t.Literal('toolActivity'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  activeCount: t.Number(),
  completedCount: t.Number(),
  failedCount: t.Number(),
  recentItems: t.Array(
    t.Object({
      id: t.String(),
      type: t.String(),
      label: t.String(),
      status: runtimeToolActivityStatusSchema,
      startedAt: t.Union([t.Number(), t.Null()]),
      completedAt: t.Union([t.Number(), t.Null()])
    })
  ),
  updatedAt: t.Number()
})

export const runtimeMcpServerStatusSchema = t.Union([
  t.Literal('starting'),
  t.Literal('ready'),
  t.Literal('failed'),
  t.Literal('cancelled'),
  t.Literal('unknown')
])

export const runtimeMcpAuthStatusSchema = t.Union([
  t.Literal('unsupported'),
  t.Literal('notLoggedIn'),
  t.Literal('bearerToken'),
  t.Literal('oAuth'),
  t.Literal('unknown')
])

export const runtimeMcpUiSlotStateSchema = t.Object({
  kind: t.Literal('mcp'),
  slotId: t.String(),
  threadId: t.String(),
  serverCount: t.Number(),
  readyCount: t.Number(),
  failedCount: t.Number(),
  needsLoginCount: t.Number(),
  recentProgress: t.Union([t.String(), t.Null()]),
  servers: t.Array(
    t.Object({
      name: t.String(),
      status: runtimeMcpServerStatusSchema,
      authStatus: runtimeMcpAuthStatusSchema,
      toolCount: t.Number(),
      resourceCount: t.Number(),
      error: t.Union([t.String(), t.Null()])
    })
  ),
  updatedAt: t.Number()
})

export const runtimeDiffUiSlotStateSchema = t.Object({
  kind: t.Literal('diff'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  fileCount: t.Number(),
  addedLines: t.Number(),
  removedLines: t.Number(),
  hasDiff: t.Boolean(),
  updatedAt: t.Number()
})

export const runtimeBackgroundTerminalSchema = t.Object({
  itemId: t.String(),
  processId: t.String(),
  command: t.String(),
  cwd: t.String(),
  osPid: t.Union([t.Number(), t.Null()]),
  cpuPercent: t.Union([t.Number(), t.Null()]),
  rssKb: t.Union([t.Number(), t.Null()])
})

export const runtimeTerminalUiSlotStateSchema = t.Object({
  kind: t.Literal('terminal'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  activeCount: t.Number(),
  completedCount: t.Number(),
  failedCount: t.Number(),
  lastCommand: t.Union([t.String(), t.Null()]),
  lastOutputPreview: t.Union([t.String(), t.Null()]),
  backgroundTerminals: t.Array(runtimeBackgroundTerminalSchema),
  updatedAt: t.Number()
})

export const runtimeApprovalStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('denied'),
  t.Literal('timedOut'),
  t.Literal('aborted')
])

export const runtimeApprovalsUiSlotStateSchema = t.Object({
  kind: t.Literal('approvals'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  approvedCount: t.Number(),
  deniedCount: t.Number(),
  recentItems: t.Array(
    t.Object({
      id: t.String(),
      targetItemId: t.Union([t.String(), t.Null()]),
      status: runtimeApprovalStatusSchema,
      label: t.String(),
      riskLevel: t.Union([t.String(), t.Null()]),
      rationale: t.Union([t.String(), t.Null()]),
      startedAt: t.Union([t.Number(), t.Null()]),
      completedAt: t.Union([t.Number(), t.Null()])
    })
  ),
  updatedAt: t.Number()
})

export const runtimeAlertSeveritySchema = t.Union([
  t.Literal('info'),
  t.Literal('warning'),
  t.Literal('error')
])

export const runtimeAlertUiSlotStateSchema = t.Object({
  kind: t.Literal('alert'),
  slotId: t.String(),
  threadId: t.Union([t.String(), t.Null()]),
  warningCount: t.Number(),
  errorCount: t.Number(),
  recentItems: t.Array(
    t.Object({
      id: t.String(),
      severity: runtimeAlertSeveritySchema,
      message: t.String(),
      source: t.String(),
      updatedAt: t.Number()
    })
  ),
  updatedAt: t.Number()
})

export const runtimeFilesystemUiSlotStateSchema = t.Object({
  kind: t.Literal('filesystem'),
  slotId: t.String(),
  threadId: t.String(),
  changedPathCount: t.Number(),
  recentPaths: t.Array(t.String()),
  updatedAt: t.Number()
})

export const runtimeSkillsUiSlotStateSchema = t.Object({
  kind: t.Literal('skills'),
  slotId: t.String(),
  threadId: t.String(),
  enabledCount: t.Number(),
  disabledCount: t.Number(),
  errorCount: t.Number(),
  roots: t.Array(t.String()),
  updatedAt: t.Number()
})

export const runtimePluginUiSlotStateSchema = t.Object({
  kind: t.Literal('plugin'),
  slotId: t.String(),
  threadId: t.String(),
  installedCount: t.Number(),
  enabledCount: t.Number(),
  appCount: t.Number(),
  marketplaceCount: t.Number(),
  errorCount: t.Number(),
  updatedAt: t.Number()
})

export const runtimeSearchUiSlotStateSchema = t.Object({
  kind: t.Literal('search'),
  slotId: t.String(),
  threadId: t.String(),
  recentResultCount: t.Number(),
  recentQuery: t.Union([t.String(), t.Null()]),
  fuzzySessionActive: t.Boolean(),
  updatedAt: t.Number()
})

export const runtimeCrewCollaborationModeSchema = t.Object({
  name: t.String(),
  mode: t.Union([t.String(), t.Null()]),
  model: t.Union([t.String(), t.Null()]),
  reasoningEffort: t.Union([t.String(), t.Null()])
})

export const runtimeCrewAgentItemSchema = t.Object({
  threadId: t.String(),
  status: t.Union([t.String(), t.Null()]),
  message: t.Union([t.String(), t.Null()]),
  name: t.Union([t.String(), t.Null()]),
  preview: t.Union([t.String(), t.Null()]),
  modelProvider: t.Union([t.String(), t.Null()]),
  agentNickname: t.Union([t.String(), t.Null()]),
  agentRole: t.Union([t.String(), t.Null()])
})

export const runtimeCrewCallItemSchema = t.Object({
  id: t.String(),
  tool: t.String(),
  status: runtimeToolActivityStatusSchema,
  senderThreadId: t.Union([t.String(), t.Null()]),
  receiverThreadIds: t.Array(t.String()),
  prompt: t.Union([t.String(), t.Null()]),
  model: t.Union([t.String(), t.Null()]),
  reasoningEffort: t.Union([t.String(), t.Null()]),
  agents: t.Array(runtimeCrewAgentItemSchema),
  startedAt: t.Union([t.Number(), t.Null()]),
  completedAt: t.Union([t.Number(), t.Null()])
})

export const runtimeCrewUiSlotStateSchema = t.Object({
  kind: t.Literal('crew'),
  slotId: t.String(),
  threadId: t.String(),
  activeCount: t.Number(),
  completedCount: t.Number(),
  failedCount: t.Number(),
  recentItems: t.Array(
    t.Object({
      id: t.String(),
      type: t.String(),
      label: t.String(),
      status: runtimeToolActivityStatusSchema,
      startedAt: t.Union([t.Number(), t.Null()]),
      completedAt: t.Union([t.Number(), t.Null()])
    })
  ),
  agents: t.Array(runtimeCrewAgentItemSchema),
  collaborationModeCount: t.Number(),
  collaborationModes: t.Array(runtimeCrewCollaborationModeSchema),
  calls: t.Array(runtimeCrewCallItemSchema),
  updatedAt: t.Number()
})

export const runtimeUsageUiSlotStateSchema = t.Object({
  kind: t.Literal('usage'),
  slotId: t.String(),
  threadId: t.String(),
  limitName: t.Union([t.String(), t.Null()]),
  usedPercent: t.Union([t.Number(), t.Null()]),
  primaryWindowDurationMins: t.Union([t.Number(), t.Null()]),
  primaryResetsAt: t.Union([t.Number(), t.Null()]),
  secondaryUsedPercent: t.Union([t.Number(), t.Null()]),
  secondaryWindowDurationMins: t.Union([t.Number(), t.Null()]),
  secondaryResetsAt: t.Union([t.Number(), t.Null()]),
  creditsBalance: t.Union([t.String(), t.Null()]),
  hasCredits: t.Union([t.Boolean(), t.Null()]),
  rateLimitReachedType: t.Union([t.String(), t.Null()]),
  planType: t.Union([t.String(), t.Null()]),
  updatedAt: t.Number()
})

export const runtimeConfigUiSlotStateSchema = t.Object({
  kind: t.Literal('config'),
  slotId: t.String(),
  threadId: t.String(),
  modelId: t.Union([t.String(), t.Null()]),
  approvalPolicy: t.Union([t.String(), t.Null()]),
  sandboxMode: t.Union([t.String(), t.Null()]),
  allowedApprovalPolicyCount: t.Union([t.Number(), t.Null()]),
  allowedSandboxModeCount: t.Union([t.Number(), t.Null()]),
  featureRequirementCount: t.Union([t.Number(), t.Null()]),
  webSearchModeCount: t.Union([t.Number(), t.Null()]),
  updatedAt: t.Number()
})

export const runtimeContextUsageItemSchema = t.Object({
  kind: t.String(),
  label: t.String(),
  tokenCount: t.Number(),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
  raw: t.Optional(t.Any())
})

export const runtimeContextUsageSectionSchema = t.Object({
  kind: t.String(),
  label: t.String(),
  tokenCount: t.Number(),
  color: t.Union([t.String(), t.Null()]),
  isDeferred: t.Boolean(),
  items: t.Array(runtimeContextUsageItemSchema),
  raw: t.Optional(t.Any())
})

export const runtimeContextUsageSchema = t.Object({
  runtimeKind: t.String(),
  providerSessionId: t.Union([t.String(), t.Null()]),
  source: t.String(),
  model: t.Union([t.String(), t.Null()]),
  totalTokens: t.Number(),
  maxTokens: t.Union([t.Number(), t.Null()]),
  rawMaxTokens: t.Union([t.Number(), t.Null()]),
  percentage: t.Union([t.Number(), t.Null()]),
  sections: t.Array(runtimeContextUsageSectionSchema),
  messageBreakdown: t.Union([t.Record(t.String(), t.Any()), t.Null()]),
  apiUsage: t.Union([t.Record(t.String(), t.Any()), t.Null()]),
  raw: t.Any(),
  updatedAt: t.Number()
})

export const runtimeUiSlotStateSchema = t.Union([
  runtimeGoalUiSlotStateSchema,
  runtimeCompactUiSlotStateSchema,
  runtimeStatusUiSlotStateSchema,
  runtimeModelUiSlotStateSchema,
  runtimeReasoningUiSlotStateSchema,
  runtimePlanUiSlotStateSchema,
  runtimeProgressUiSlotStateSchema,
  runtimeUserInputUiSlotStateSchema,
  runtimeToolActivityUiSlotStateSchema,
  runtimeMcpUiSlotStateSchema,
  runtimeDiffUiSlotStateSchema,
  runtimeTerminalUiSlotStateSchema,
  runtimeApprovalsUiSlotStateSchema,
  runtimeAlertUiSlotStateSchema,
  runtimeFilesystemUiSlotStateSchema,
  runtimeSkillsUiSlotStateSchema,
  runtimePluginUiSlotStateSchema,
  runtimeSearchUiSlotStateSchema,
  runtimeCrewUiSlotStateSchema,
  runtimeUsageUiSlotStateSchema,
  runtimeConfigUiSlotStateSchema
])
