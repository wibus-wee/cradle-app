import { t } from 'elysia'

import { SessionModel } from '../session/model'
import {
  runtimeSettingsPatchSchema,
  runtimeSettingsSchema,
  sessionRuntimeSettingsPatchSchema,
  sessionClaudeAgentConfigSchema,
} from './runtime-settings-model'

const runtimeKindSchema = t.String({ minLength: 1 })

const uiMessageSchema = t.Object(
  {
    id: t.String(),
    role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant')]),
    parts: t.Array(
      t.Object(
        {
          type: t.String()
        },
        { additionalProperties: t.Any() }
      )
    ),
    metadata: t.Optional(t.Any())
  },
  { additionalProperties: true }
)

const chatMessageSnapshotSchema = t.Object({
  messageId: t.String(),
  role: t.Union([t.Literal('user'), t.Literal('assistant')]),
  status: t.Union([
    t.Literal('streaming'),
    t.Literal('complete'),
    t.Literal('aborted'),
    t.Literal('failed')
  ]),
  errorText: t.Optional(t.String()),
  content: t.String(),
  message: uiMessageSchema,
  parentMessageId: t.Union([t.String(), t.Null()]),
  parentToolCallId: t.Union([t.String(), t.Null()]),
  taskId: t.Union([t.String(), t.Null()]),
  depth: t.Number()
})

const slashCommandSchema = t.Object({
  name: t.String(),
  description: t.String(),
  argumentHint: t.String(),
  aliases: t.Optional(t.Array(t.String()))
})

const runtimeCatalogItemSchema = t.Object({
  runtimeKind: t.String(),
  label: t.String(),
  description: t.Optional(t.String()),
  providerKinds: t.Array(t.String()),
  providerBinding: t.Optional(t.Union([t.Literal('required'), t.Literal('runtime-owned')])),
  iconKey: t.Optional(t.String()),
  surfaces: t.Optional(t.Array(t.Union([t.Literal('chat'), t.Literal('jarvis')]))),
  sortOrder: t.Optional(t.Number()),
  source: t.Union([t.Literal('builtin'), t.Literal('plugin')]),
  pluginOwner: t.Union([t.String(), t.Null()])
})

const runtimeHealthItemSchema = t.Object({
  runtimeKind: t.String(),
  source: t.Union([t.Literal('builtin'), t.Literal('plugin')]),
  pluginOwner: t.Union([t.String(), t.Null()]),
  hasHealthCheck: t.Boolean(),
  status: t.Union([t.Literal('healthy'), t.Literal('unhealthy'), t.Literal('unknown')]),
  message: t.Optional(t.String()),
  latencyMs: t.Optional(t.Number()),
  lastCheckedAt: t.Number()
})

const runtimeModelSourceSchema = t.Union([
  t.Literal('runtime'),
  t.Literal('runtime-cache'),
  t.Literal('opencode-sdk'),
  t.Literal('opencode-cli'),
  t.Literal('fallback')
])

const runtimeModelDescriptorSchema = t.Object({
  id: t.String(),
  label: t.String(),
  providerKind: t.Union([
    t.Literal('openai-compatible'),
    t.Literal('anthropic'),
    t.Literal('universal')
  ]),
  capabilities: t.Object({
    contextWindow: t.Optional(t.Number()),
    maxOutput: t.Optional(t.Number()),
    inputModalities: t.Optional(t.Array(t.String())),
    outputModalities: t.Optional(t.Array(t.String())),
    reasoning: t.Optional(t.Boolean()),
    reasoningEfforts: t.Optional(t.Array(t.Union([
      t.Literal('none'),
      t.Literal('minimal'),
      t.Literal('low'),
      t.Literal('medium'),
      t.Literal('high'),
      t.Literal('xhigh'),
      t.Literal('max')
    ]))),
    toolCall: t.Optional(t.Boolean()),
    temperature: t.Optional(t.Boolean()),
    structuredOutput: t.Optional(t.Boolean()),
    cost: t.Optional(t.Object({
      input: t.Optional(t.Number()),
      output: t.Optional(t.Number()),
      cacheRead: t.Optional(t.Number()),
      cacheWrite: t.Optional(t.Number())
    })),
    family: t.Optional(t.String()),
    knowledgeCutoff: t.Optional(t.String()),
    releaseDate: t.Optional(t.String()),
    registryMatch: t.Optional(t.Union([
      t.Literal('exact'),
      t.Literal('fuzzy'),
      t.Literal('manual'),
      t.Literal('alias'),
      t.Literal('unmatched')
    ])),
    registryModelId: t.Optional(t.String()),
    registryModelLabel: t.Optional(t.String())
  }),
  runtimeKind: t.String(),
  source: runtimeModelSourceSchema,
  nativeProviderId: t.Optional(t.String())
})

const runtimeUiSlotSchema = t.Object({
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

const runtimeGoalStatusSchema = t.Union([
  t.Literal('active'),
  t.Literal('paused'),
  t.Literal('blocked'),
  t.Literal('usageLimited'),
  t.Literal('budgetLimited'),
  t.Literal('complete')
])

const runtimeGoalUiSlotStateSchema = t.Object({
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

const runtimeTokenUsageBreakdownSchema = t.Object({
  totalTokens: t.Number(),
  inputTokens: t.Number(),
  cachedInputTokens: t.Number(),
  outputTokens: t.Number(),
  reasoningOutputTokens: t.Number()
})

const runtimeCompactStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('running'),
  t.Literal('nearLimit'),
  t.Literal('overLimit'),
  t.Literal('compacted')
])

const runtimeCompactUiSlotStateSchema = t.Object({
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

const runtimeStatusUiSlotStateSchema = t.Object({
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

const runtimeModelUiSlotStateSchema = t.Object({
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

const runtimeReasoningUiSlotStateSchema = t.Object({
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

const runtimePlanStepStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('inProgress'),
  t.Literal('completed')
])

const runtimePlanUiSlotStateSchema = t.Object({
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

const runtimeProgressUiSlotStateSchema = t.Object({
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

const runtimeUserInputQuestionSchema = t.Object({
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

const runtimeUserInputUiSlotStateSchema = t.Object({
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

const runtimeToolActivityStatusSchema = t.Union([
  t.Literal('running'),
  t.Literal('completed'),
  t.Literal('failed')
])

const runtimeToolActivityUiSlotStateSchema = t.Object({
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

const runtimeMcpServerStatusSchema = t.Union([
  t.Literal('starting'),
  t.Literal('ready'),
  t.Literal('failed'),
  t.Literal('cancelled'),
  t.Literal('unknown')
])

const runtimeMcpAuthStatusSchema = t.Union([
  t.Literal('unsupported'),
  t.Literal('notLoggedIn'),
  t.Literal('bearerToken'),
  t.Literal('oAuth'),
  t.Literal('unknown')
])

const runtimeMcpUiSlotStateSchema = t.Object({
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

const runtimeDiffUiSlotStateSchema = t.Object({
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

const runtimeBackgroundTerminalSchema = t.Object({
  itemId: t.String(),
  processId: t.String(),
  command: t.String(),
  cwd: t.String(),
  osPid: t.Union([t.Number(), t.Null()]),
  cpuPercent: t.Union([t.Number(), t.Null()]),
  rssKb: t.Union([t.Number(), t.Null()])
})

const runtimeTerminalUiSlotStateSchema = t.Object({
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

const runtimeApprovalStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('denied'),
  t.Literal('timedOut'),
  t.Literal('aborted')
])

const runtimeApprovalsUiSlotStateSchema = t.Object({
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

const runtimeAlertSeveritySchema = t.Union([
  t.Literal('info'),
  t.Literal('warning'),
  t.Literal('error')
])

const runtimeAlertUiSlotStateSchema = t.Object({
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

const runtimeFilesystemUiSlotStateSchema = t.Object({
  kind: t.Literal('filesystem'),
  slotId: t.String(),
  threadId: t.String(),
  changedPathCount: t.Number(),
  recentPaths: t.Array(t.String()),
  updatedAt: t.Number()
})

const runtimeSkillsUiSlotStateSchema = t.Object({
  kind: t.Literal('skills'),
  slotId: t.String(),
  threadId: t.String(),
  enabledCount: t.Number(),
  disabledCount: t.Number(),
  errorCount: t.Number(),
  roots: t.Array(t.String()),
  updatedAt: t.Number()
})

const runtimePluginUiSlotStateSchema = t.Object({
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

const runtimeSearchUiSlotStateSchema = t.Object({
  kind: t.Literal('search'),
  slotId: t.String(),
  threadId: t.String(),
  recentResultCount: t.Number(),
  recentQuery: t.Union([t.String(), t.Null()]),
  fuzzySessionActive: t.Boolean(),
  updatedAt: t.Number()
})

const runtimeCrewCollaborationModeSchema = t.Object({
  name: t.String(),
  mode: t.Union([t.String(), t.Null()]),
  model: t.Union([t.String(), t.Null()]),
  reasoningEffort: t.Union([t.String(), t.Null()])
})

const runtimeCrewAgentItemSchema = t.Object({
  threadId: t.String(),
  status: t.Union([t.String(), t.Null()]),
  message: t.Union([t.String(), t.Null()]),
  name: t.Union([t.String(), t.Null()]),
  preview: t.Union([t.String(), t.Null()]),
  modelProvider: t.Union([t.String(), t.Null()]),
  agentNickname: t.Union([t.String(), t.Null()]),
  agentRole: t.Union([t.String(), t.Null()])
})

const runtimeCrewCallItemSchema = t.Object({
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

const runtimeCrewUiSlotStateSchema = t.Object({
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

const runtimeUsageUiSlotStateSchema = t.Object({
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

const runtimeConfigUiSlotStateSchema = t.Object({
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

const runtimeContextUsageItemSchema = t.Object({
  kind: t.String(),
  label: t.String(),
  tokenCount: t.Number(),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
  raw: t.Optional(t.Any())
})

const runtimeContextUsageSectionSchema = t.Object({
  kind: t.String(),
  label: t.String(),
  tokenCount: t.Number(),
  color: t.Union([t.String(), t.Null()]),
  isDeferred: t.Boolean(),
  items: t.Array(runtimeContextUsageItemSchema),
  raw: t.Optional(t.Any())
})

const runtimeContextUsageSchema = t.Object({
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

const runtimeUiSlotStateSchema = t.Union([
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

const filePartSchema = t.Object(
  {
    type: t.Literal('file'),
    mediaType: t.String({ minLength: 1 }),
    filename: t.Optional(t.String()),
    url: t.String({ minLength: 1 }),
    providerMetadata: t.Optional(t.Any())
  },
  { additionalProperties: true }
)

const contextPartSchema = t.Union([
  t.Object(
    {
      type: t.Literal('data-cradle-skill'),
      name: t.String({ minLength: 1 }),
      path: t.String({ minLength: 1 }),
      scope: t.Union([
        t.Literal('builtin'),
        t.Literal('legacy'),
        t.Literal('global'),
        t.Literal('repository'),
        t.Literal('workspace'),
        t.Literal('agent')
      ]),
      description: t.Union([t.String(), t.Null()]),
      position: t.Optional(t.Number({ minimum: 0 }))
    },
    { additionalProperties: false }
  ),
  t.Object(
    {
      type: t.Literal('data-cradle-plugin'),
      provider: t.Optional(t.Union([t.Literal('cradle'), t.Literal('codex')])),
      pluginName: t.String({ minLength: 1 }),
      displayName: t.String({ minLength: 1 }),
      description: t.Union([t.String(), t.Null()]),
      iconUrl: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
      routeSegment: t.String({ minLength: 1 }),
      capabilities: t.Array(
        t.Object(
          {
            id: t.String({ minLength: 1 }),
            type: t.String({ minLength: 1 }),
            layer: t.Union([t.Literal('server'), t.Literal('web'), t.Literal('desktop')]),
            label: t.Union([t.String(), t.Null()])
          },
          { additionalProperties: false }
        )
      ),
      mcpServers: t.Array(t.String({ minLength: 1 })),
      nativeMention: t.Optional(
        t.Union([
          t.Object(
            {
              name: t.String({ minLength: 1 }),
              path: t.String({ minLength: 1 })
            },
            { additionalProperties: false }
          ),
          t.Null()
        ])
      ),
      position: t.Optional(t.Number({ minimum: 0 }))
    },
    { additionalProperties: false }
  )
])

const queueModeSchema = t.Literal('queue')
const queueStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('cancelled'),
  t.Literal('completed'),
  t.Literal('failed')
])
const messageStatusSchema = t.Union([
  t.Literal('streaming'),
  t.Literal('complete'),
  t.Literal('aborted'),
  t.Literal('failed')
])
const runSnapshotStatusSchema = t.Union([
  t.Literal('running'),
  t.Literal('complete'),
  t.Literal('aborted'),
  t.Literal('failed')
])
const tracePhaseSchema = t.Union([
  t.Literal('run_started'),
  t.Literal('provider_raw'),
  t.Literal('mapper_output'),
  t.Literal('runtime_chunk'),
  t.Literal('sse_emit'),
  t.Literal('run_completed'),
  t.Literal('run_failed'),
  t.Literal('run_aborted')
])

const thinkingEffortSchema = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh')
])
const nullableModelIdSchema = t.Union([t.String(), t.Null()])

const queueItemSchema = t.Object({
  id: t.String(),
  sessionId: t.String(),
  mode: queueModeSchema,
  status: queueStatusSchema,
  text: t.String(),
  files: t.Array(filePartSchema),
  contextParts: t.Array(contextPartSchema),
  providerTargetId: t.Union([t.String(), t.Null()]),
  modelId: t.Union([t.String(), t.Null()]),
  thinkingEffort: t.Union([thinkingEffortSchema, t.Null()]),
  runtimeSettings: runtimeSettingsSchema,
  position: t.Number(),
  sourceRunId: t.Union([t.String(), t.Null()]),
  startedRunId: t.Union([t.String(), t.Null()]),
  errorText: t.Union([t.String(), t.Null()]),
  createdAt: t.Number(),
  updatedAt: t.Number()
})

const traceRecordSchema = t.Object({
  schema: t.Literal('cradle.chat-stream-trace.v1'),
  seq: t.Number(),
  phase: tracePhaseSchema,
  timestamp: t.Number(),
  chatSessionId: t.String(),
  runId: t.String(),
  messageId: t.String(),
  runtimeKind: t.String(),
  providerSessionId: t.Union([t.String(), t.Null()]),
  toolCallId: t.Union([t.String(), t.Null()]),
  payload: t.Any()
})

const runTraceSchema = t.Object({
  runId: t.String(),
  sessionId: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  status: messageStatusSchema,
  startedAt: t.Number(),
  finishedAt: t.Union([t.Number(), t.Null()]),
  path: t.String(),
  recordCount: t.Number(),
  records: t.Array(traceRecordSchema)
})

const runSnapshotEventSchema = t.Object({
  id: t.String(),
  snapshotId: t.String(),
  chatSessionId: t.Union([t.String(), t.Null()]),
  runId: t.Union([t.String(), t.Null()]),
  seq: t.Number(),
  phase: t.String(),
  chunkType: t.Optional(t.String()),
  toolCallId: t.Optional(t.String()),
  toolName: t.Optional(t.String()),
  modelId: t.Optional(t.String()),
  promptTokens: t.Optional(t.Number()),
  completionTokens: t.Optional(t.Number()),
  totalTokens: t.Optional(t.Number()),
  estimatedCostUsd: t.Optional(t.Number()),
  occurredAt: t.Number(),
  durationMs: t.Optional(t.Number()),
  payload: t.Record(t.String(), t.Unknown())
})

const runSnapshotSchema = t.Object({
  id: t.String(),
  schemaVersion: t.Number(),
  traceId: t.String(),
  chatSessionId: t.Union([t.String(), t.Null()]),
  runId: t.Union([t.String(), t.Null()]),
  messageId: t.Optional(t.String()),
  providerTargetId: t.Optional(t.String()),
  runtimeKind: t.String(),
  providerSessionId: t.Optional(t.String()),
  modelId: t.Optional(t.String()),
  agentId: t.Optional(t.String()),
  workspaceId: t.Optional(t.String()),
  status: runSnapshotStatusSchema,
  startedAt: t.Number(),
  completedAt: t.Union([t.Number(), t.Null()]),
  completionReason: t.Optional(t.String()),
  errorText: t.Optional(t.String()),
  summary: t.Record(t.String(), t.Unknown()),
  events: t.Array(runSnapshotEventSchema)
})

const completedRunSchema = t.Object({
  runId: t.String(),
  sessionId: t.String(),
  sessionTitle: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  responseBody: t.Union([t.String(), t.Null()]),
  messagePreview: t.Union([t.String(), t.Null()]),
  startedAt: t.Number(),
  finishedAt: t.Number()
})

const runtimeStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('pending'),
  t.Literal('streaming'),
  t.Literal('cancelling')
])
const providerThreadSourceKindSchema = t.Union([
  t.Literal('cli'),
  t.Literal('vscode'),
  t.Literal('exec'),
  t.Literal('appServer'),
  t.Literal('subAgent'),
  t.Literal('subAgentReview'),
  t.Literal('subAgentCompact'),
  t.Literal('subAgentThreadSpawn'),
  t.Literal('subAgentOther'),
  t.Literal('unknown')
])

const providerThreadSchema = t.Object({
  id: t.String(),
  providerSessionTreeId: t.Union([t.String(), t.Null()]),
  forkedFromId: t.Union([t.String(), t.Null()]),
  preview: t.Union([t.String(), t.Null()]),
  ephemeral: t.Boolean(),
  modelProvider: t.Union([t.String(), t.Null()]),
  createdAt: t.Union([t.Number(), t.Null()]),
  updatedAt: t.Union([t.Number(), t.Null()]),
  status: t.String(),
  sourceKind: providerThreadSourceKindSchema,
  source: t.Any(),
  threadSource: t.Any(),
  agentNickname: t.Union([t.String(), t.Null()]),
  agentRole: t.Union([t.String(), t.Null()]),
  name: t.Union([t.String(), t.Null()]),
  cwd: t.Union([t.String(), t.Null()])
})

const providerThreadTurnSchema = t.Object({
  id: t.String(),
  status: t.String(),
  startedAt: t.Union([t.Number(), t.Null()]),
  completedAt: t.Union([t.Number(), t.Null()]),
  durationMs: t.Union([t.Number(), t.Null()]),
  itemsView: t.String(),
  items: t.Array(t.Any())
})

const runtimeSessionRunSchema = t.Object({
  runId: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  status: messageStatusSchema,
  startedAt: t.Number(),
  finishedAt: t.Union([t.Number(), t.Null()]),
  modelId: t.Union([t.String(), t.Null()]),
  providerSessionId: t.Union([t.String(), t.Null()]),
  queueItemId: t.Union([t.String(), t.Null()]),
  runtimeSettings: runtimeSettingsSchema
})

const codexAppServerCapabilitySchema = t.Object({
  method: t.String(),
  paramsType: t.Nullable(t.String()),
  category: t.String(),
  operation: t.String(),
  interaction: t.Union([t.Literal('request'), t.Literal('stream')])
})

const codexAppServerServerMessageSchema = t.Object({
  method: t.String(),
  paramsType: t.String(),
  category: t.String()
})

export const ChatRuntimeModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 })
  }),

  runIdParams: t.Object({
    runId: t.String({ minLength: 1 })
  }),

  sideConversationParams: t.Object({
    sideConversationId: t.String({ minLength: 1 })
  }),

  completedRunsQuery: t.Object({
    since: t.Optional(t.Number({ minimum: 0 })),
    limit: t.Optional(t.Number({ minimum: 1, maximum: 200 }))
  }),

  providerThreadParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    threadId: t.String({ minLength: 1 })
  }),

  backgroundTerminalParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    processId: t.String({ minLength: 1 })
  }),

  draftRuntimeCapabilitiesQuery: t.Object({
    runtimeKind: runtimeKindSchema
  }),

  providerThreadsQuery: t.Object({
    cursor: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    sortKey: t.Optional(t.Union([t.Literal('created_at'), t.Literal('updated_at')])),
    sortDirection: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
    sourceKinds: t.Optional(t.String()),
    archived: t.Optional(t.Boolean()),
    searchTerm: t.Optional(t.String())
  }),

  providerThreadTurnsQuery: t.Object({
    cursor: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    sortDirection: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')]))
  }),

  backgroundTerminalsQuery: t.Object({
    cursor: t.Optional(t.String()),
    limit: t.Optional(t.Number())
  }),

  queueItemParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    queueItemId: t.String({ minLength: 1 })
  }),

  userInputParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    requestId: t.String({ minLength: 1 })
  }),

  toolApprovalParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    requestId: t.String({ minLength: 1 })
  }),

  planImplementationApprovalParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    messageId: t.String({ minLength: 1 })
  }),

  responseBody: t.Object({
    text: t.Optional(t.String()),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    messages: t.Optional(t.Array(uiMessageSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    runtimeSettings: t.Optional(runtimeSettingsPatchSchema)
  }),

  bangCommandBody: t.Object({
    command: t.String({ minLength: 1 })
  }),

  sideChatBody: t.Object({
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema)
  }),

  quickQuestionBody: t.Object({
    question: t.String({ minLength: 1 })
  }),

  userInputBody: t.Object({
    answers: t.Record(t.String(), t.Array(t.String()))
  }),

  toolApprovalBody: t.Object({
    approved: t.Boolean(),
    reason: t.Optional(t.String())
  }),

  toolApprovalResponse: t.Object({
    requestId: t.String(),
    approved: t.Boolean(),
    reason: t.Optional(t.String())
  }),

  planImplementationApprovalBody: t.Object({
    approvalId: t.String({ minLength: 1 }),
    approved: t.Boolean()
  }),

  sideChatResponse: t.Object({
    sideConversationId: t.String(),
    parentSessionId: t.String(),
    runtimeKind: t.String(),
    providerTargetId: t.Union([t.String(), t.Null()]),
    providerSessionId: t.Union([t.String(), t.Null()]),
    title: t.String(),
  }),

  bangCommandResponse: t.Object({
    command: t.String(),
    stdout: t.String(),
    stderr: t.String(),
    exitCode: t.Union([t.Number(), t.Null()]),
    durationMs: t.Number(),
    timedOut: t.Boolean(),
    truncated: t.Boolean(),
    userMessageId: t.String(),
    resultMessageId: t.String(),
    userMessage: uiMessageSchema,
    resultMessage: uiMessageSchema
  }),

  cancelResponse: t.Object({
    ok: t.Literal(true)
  }),

  rollbackLastTurnResponse: t.Object({
    ok: t.Literal(true),
    sessionId: t.String(),
    messageIds: t.Array(t.String()),
    providerRuntimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    providerRolledBackTurns: t.Number(),
    fileChangesReverted: t.Literal(false)
  }),

  regeneratedTitleResponse: SessionModel.session,

  userInputResponse: t.Object({
    requestId: t.String(),
    answers: t.Record(t.String(), t.Array(t.String()))
  }),

  planImplementationApprovalResponse: t.Object({
    message: uiMessageSchema
  }),

  runtimeSettingsBody: sessionRuntimeSettingsPatchSchema,

  runtimeSettingsResponse: t.Object({
    sessionId: t.String(),
    runtimeSettings: runtimeSettingsSchema,
    claudeAgent: t.Union([sessionClaudeAgentConfigSchema, t.Null()]),
    applied: t.Boolean()
  }),

  codexAppServerCapabilities: t.Object({
    protocol: t.String(),
    generatorVersion: t.String(),
    generatedDate: t.String(),
    clientMethods: t.Array(codexAppServerCapabilitySchema),
    serverRequests: t.Array(codexAppServerServerMessageSchema),
    serverNotifications: t.Array(codexAppServerServerMessageSchema)
  }),

  codexAppServerInvokeBody: t.Object({
    method: t.String({ minLength: 1 }),
    params: t.Optional(t.Any()),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String())
  }),

  codexAppServerStreamBody: t.Object({
    method: t.String({ minLength: 1 }),
    params: t.Optional(t.Any()),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    closeOnMethods: t.Optional(t.Array(t.String({ minLength: 1 })))
  }),

  codexAppServerInvokeResponse: t.Object({
    method: t.String(),
    capability: codexAppServerCapabilitySchema,
    result: t.Any()
  }),

  runtimeCatalog: t.Object({
    items: t.Array(runtimeCatalogItemSchema)
  }),

  runtimeHealth: t.Object({
    items: t.Array(runtimeHealthItemSchema)
  }),

  runtimeModelsQuery: t.Object({
    workspaceId: t.Optional(t.String())
  }),

  runtimeKindParams: t.Object({
    runtimeKind: runtimeKindSchema
  }),

  runtimeModelCatalog: t.Object({
    runtimeKind: t.String(),
    source: runtimeModelSourceSchema,
    fetchedAt: t.Number(),
    models: t.Array(runtimeModelDescriptorSchema)
  }),

  capabilities: t.Object({
    runtimeKind: t.String(),
    slashCommands: t.Array(slashCommandSchema),
    uiSlots: t.Array(runtimeUiSlotSchema),
    skills: t.Array(t.String())
  }),

  uiSlotStates: t.Object({
    runtimeKind: t.String(),
    states: t.Array(runtimeUiSlotStateSchema)
  }),

  contextUsageResponse: t.Object({
    sessionId: t.String(),
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    usage: t.Union([runtimeContextUsageSchema, t.Null()])
  }),

  runtimeStatus: t.Object({
    sessionId: t.String(),
    status: runtimeStatusSchema,
    runtimeKind: t.String(),
    providerTargetId: t.Union([t.String(), t.Null()]),
    providerSessionId: t.Union([t.String(), t.Null()]),
    modelId: t.Union([t.String(), t.Null()]),
    runtimeSettings: runtimeSettingsSchema,
    pendingQueueItemId: t.Union([t.String(), t.Null()]),
    hasActiveGoal: t.Boolean(),
    supportsLastTurnRollback: t.Boolean(),
    activeRun: t.Union([runtimeSessionRunSchema, t.Null()]),
    latestRun: t.Union([runtimeSessionRunSchema, t.Null()]),
    queue: t.Object({
      pending: t.Number(),
      running: t.Number()
    })
  }),

  providerThreads: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    threads: t.Array(providerThreadSchema),
    nextCursor: t.Union([t.String(), t.Null()]),
    backwardsCursor: t.Union([t.String(), t.Null()])
  }),

  providerThread: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    thread: providerThreadSchema
  }),

  providerThreadDelete: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    threadId: t.String(),
    deleted: t.Literal(true)
  }),

  providerThreadTurns: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    threadId: t.String(),
    turns: t.Array(providerThreadTurnSchema),
    messages: t.Array(uiMessageSchema),
    nextCursor: t.Union([t.String(), t.Null()]),
    backwardsCursor: t.Union([t.String(), t.Null()])
  }),

  backgroundTerminals: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    terminals: t.Array(runtimeBackgroundTerminalSchema),
    nextCursor: t.Union([t.String(), t.Null()])
  }),

  backgroundTerminalTerminate: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    processId: t.String(),
    terminated: t.Boolean()
  }),

  chatMessages: t.Array(chatMessageSnapshotSchema),

  queueItem: queueItemSchema,

  queueListResponse: t.Object({
    items: t.Array(queueItemSchema)
  }),

  traceRecord: traceRecordSchema,

  runTrace: runTraceSchema,

  runSnapshot: runSnapshotSchema,

  sessionTraces: t.Object({
    sessionId: t.String(),
    traces: t.Array(runTraceSchema)
  }),

  sessionRunSnapshots: t.Object({
    sessionId: t.String(),
    snapshots: t.Array(runSnapshotSchema)
  }),

  completedRuns: t.Object({
    runs: t.Array(completedRunSchema)
  }),

  queueEnqueueBody: t.Object({
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    runtimeSettings: t.Optional(runtimeSettingsPatchSchema)
  }),

  steerBody: t.Object({
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    providerTargetId: t.Optional(t.String())
  }),

  steerResponse: t.Object({
    ok: t.Literal(true),
    sessionId: t.String(),
    runId: t.String(),
    sourceMessageId: t.String(),
    message: uiMessageSchema
  }),

  queueReorderBody: t.Object({
    queueItemIds: t.Array(t.String({ minLength: 1 }))
  }),

  queueUpdateBody: t.Object({
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    runtimeSettings: t.Optional(runtimeSettingsPatchSchema)
  })
}
