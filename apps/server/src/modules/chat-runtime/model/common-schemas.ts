import { t } from 'elysia'

import { runtimeSettingsSchema } from '../runtime-settings-model'
import { runtimeUiSlotSchema } from './ui-slot-schemas'

export const runtimeKindSchema = t.String({ minLength: 1 })

export const uiMessageSchema = t.Object(
  {
    id: t.String(),
    role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant')]),
    parts: t.Array(
      t.Object(
        {
          type: t.String(),
        },
        { additionalProperties: t.Any() },
      ),
    ),
    metadata: t.Optional(t.Any()),
  },
  { additionalProperties: true },
)

export const chatMessageSnapshotSchema = t.Object({
  messageId: t.String(),
  role: t.Union([t.Literal('user'), t.Literal('assistant')]),
  status: t.Union([
    t.Literal('streaming'),
    t.Literal('complete'),
    t.Literal('aborted'),
    t.Literal('failed'),
  ]),
  errorText: t.Optional(t.String()),
  content: t.String(),
  message: uiMessageSchema,
  parentMessageId: t.Union([t.String(), t.Null()]),
  parentToolCallId: t.Union([t.String(), t.Null()]),
  taskId: t.Union([t.String(), t.Null()]),
  depth: t.Number(),
})

export const slashCommandSchema = t.Object({
  name: t.String(),
  description: t.String(),
  argumentHint: t.String(),
  aliases: t.Optional(t.Array(t.String())),
})

export const runtimeCapabilitiesSchema = t.Object({
  supportsSteerTurn: t.Boolean(),
  supportsShellExecution: t.Boolean(),
  supportsLastTurnRollback: t.Boolean(),
  supportsRuntimeSettings: t.Boolean(),
  supportsUiSlotStates: t.Boolean(),
  supportsDynamicCapabilities: t.Boolean(),
  supportsTitleGeneration: t.Boolean(),
  sessionModelSwitch: t.Union([
    t.Literal('in-session'),
    t.Literal('restart-session'),
    t.Literal('unsupported'),
  ]),
})

export const runtimeCapabilityDegradationSchema = t.Object({
  capability: t.String({ minLength: 1 }),
  status: t.Union([
    t.Literal('unsupported'),
    t.Literal('partial'),
    t.Literal('experimental'),
  ]),
  reason: t.String({ minLength: 1 }),
})

export const runtimeIconDescriptorSchema = t.Union([
  t.Object({ key: t.String({ minLength: 1 }) }, { additionalProperties: false }),
  t.Object({ svg: t.String({ minLength: 1 }) }, { additionalProperties: false }),
  t.Object({ url: t.String({ minLength: 1 }) }, { additionalProperties: false }),
])

export const runtimeComposerDescriptorSchema = t.Object({
  inputMode: t.Union([
    t.Literal('rich'),
    t.Literal('collapsed'),
    t.Literal('none'),
  ]),
  allowEmptySubmit: t.Optional(t.Boolean()),
  modelSelection: t.Union([
    t.Literal('provider-model'),
    t.Literal('runtime-owned'),
    t.Literal('alias-matrix'),
    t.Literal('none'),
  ]),
  thinking: t.Union([
    t.Object({
      efforts: t.Array(t.String({ minLength: 1 })),
    }, { additionalProperties: false }),
    t.Literal('per-model'),
    t.Literal('unsupported'),
  ]),
}, { additionalProperties: false })

export const runtimeCatalogItemSchema = t.Object({
  runtimeKind: t.String(),
  label: t.String(),
  description: t.Optional(t.String()),
  providerKinds: t.Array(t.String()),
  providerBinding: t.Optional(t.Union([t.Literal('required'), t.Literal('runtime-owned')])),
  sessionLaunchMode: t.Union([t.Literal('runtime-provider'), t.Literal('agent-terminal')]),
  iconKey: t.Optional(t.String()),
  surfaces: t.Optional(t.Array(t.Union([t.Literal('chat'), t.Literal('jarvis')]))),
  sortOrder: t.Optional(t.Number()),
  stability: t.Optional(t.Union([t.Literal('stable'), t.Literal('experimental')])),
  availability: t.Union([
    t.Literal('stable'),
    t.Literal('preview'),
    t.Literal('dev-only'),
    t.Literal('hidden'),
  ]),
  degradations: t.Optional(t.Array(runtimeCapabilityDegradationSchema)),
  icon: runtimeIconDescriptorSchema,
  composer: runtimeComposerDescriptorSchema,
  slots: t.Array(runtimeUiSlotSchema),
  settingsSchema: t.Optional(t.Record(t.String(), t.Any())),
  source: t.Union([t.Literal('builtin'), t.Literal('plugin')]),
  pluginOwner: t.Union([t.String(), t.Null()]),
  capabilities: t.Union([runtimeCapabilitiesSchema, t.Null()]),
})

export const runtimeHealthItemSchema = t.Object({
  runtimeKind: t.String(),
  source: t.Union([t.Literal('builtin'), t.Literal('plugin')]),
  pluginOwner: t.Union([t.String(), t.Null()]),
  hasHealthCheck: t.Boolean(),
  status: t.Union([t.Literal('healthy'), t.Literal('unhealthy'), t.Literal('unknown')]),
  message: t.Optional(t.String()),
  latencyMs: t.Optional(t.Number()),
  lastCheckedAt: t.Number(),
})

export const runtimeModelSourceSchema = t.Union([
  t.Literal('runtime'),
  t.Literal('runtime-cache'),
  t.Literal('opencode-sdk'),
  t.Literal('opencode-cli'),
  t.Literal('fallback'),
])

export const runtimeModelDescriptorSchema = t.Object({
  id: t.String(),
  label: t.String(),
  providerKind: t.Union([
    t.Literal('openai-compatible'),
    t.Literal('anthropic'),
    t.Literal('universal'),
  ]),
  capabilities: t.Object({
    contextWindow: t.Optional(t.Number()),
    maxOutput: t.Optional(t.Number()),
    inputModalities: t.Optional(t.Array(t.String())),
    outputModalities: t.Optional(t.Array(t.String())),
    reasoning: t.Optional(t.Boolean()),
    reasoningEfforts: t.Optional(
      t.Array(
        t.Union([
          t.Literal('none'),
          t.Literal('minimal'),
          t.Literal('low'),
          t.Literal('medium'),
          t.Literal('high'),
          t.Literal('xhigh'),
          t.Literal('max'),
        ]),
      ),
    ),
    toolCall: t.Optional(t.Boolean()),
    temperature: t.Optional(t.Boolean()),
    structuredOutput: t.Optional(t.Boolean()),
    cost: t.Optional(
      t.Object({
        input: t.Optional(t.Number()),
        output: t.Optional(t.Number()),
        cacheRead: t.Optional(t.Number()),
        cacheWrite: t.Optional(t.Number()),
      }),
    ),
    family: t.Optional(t.String()),
    knowledgeCutoff: t.Optional(t.String()),
    releaseDate: t.Optional(t.String()),
    registryMatch: t.Optional(
      t.Union([
        t.Literal('exact'),
        t.Literal('fuzzy'),
        t.Literal('manual'),
        t.Literal('alias'),
        t.Literal('unmatched'),
      ]),
    ),
    registryModelId: t.Optional(t.String()),
    registryModelLabel: t.Optional(t.String()),
  }),
  runtimeKind: t.String(),
  source: runtimeModelSourceSchema,
  nativeProviderId: t.Optional(t.String()),
})

export const filePartSchema = t.Object(
  {
    type: t.Literal('file'),
    mediaType: t.String({ minLength: 1 }),
    filename: t.Optional(t.String()),
    url: t.String({ minLength: 1 }),
    providerMetadata: t.Optional(t.Any()),
  },
  { additionalProperties: true },
)

export const contextPartSchema = t.Union([
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
        t.Literal('agent'),
      ]),
      description: t.Union([t.String(), t.Null()]),
      position: t.Optional(t.Number({ minimum: 0 })),
    },
    { additionalProperties: false },
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
            label: t.Union([t.String(), t.Null()]),
          },
          { additionalProperties: false },
        ),
      ),
      mcpServers: t.Array(t.String({ minLength: 1 })),
      nativeMention: t.Optional(
        t.Union([
          t.Object(
            {
              name: t.String({ minLength: 1 }),
              path: t.String({ minLength: 1 }),
            },
            { additionalProperties: false },
          ),
          t.Null(),
        ]),
      ),
      position: t.Optional(t.Number({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
])

export const queueModeSchema = t.Literal('queue')
export const queueStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('cancelled'),
  t.Literal('completed'),
  t.Literal('failed'),
])
export const messageStatusSchema = t.Union([
  t.Literal('streaming'),
  t.Literal('complete'),
  t.Literal('aborted'),
  t.Literal('failed'),
])
export const runSnapshotStatusSchema = t.Union([
  t.Literal('running'),
  t.Literal('complete'),
  t.Literal('aborted'),
  t.Literal('failed'),
])
export const tracePhaseSchema = t.Union([
  t.Literal('run_started'),
  t.Literal('provider_raw'),
  t.Literal('mapper_output'),
  t.Literal('runtime_chunk'),
  t.Literal('sse_emit'),
  t.Literal('run_completed'),
  t.Literal('run_failed'),
  t.Literal('run_aborted'),
])

export const thinkingEffortSchema = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh'),
])
export const nullableModelIdSchema = t.Union([t.String(), t.Null()])

export const queueItemSchema = t.Object({
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
  updatedAt: t.Number(),
})

export const traceRecordSchema = t.Object({
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
  payload: t.Any(),
})

export const runTraceSchema = t.Object({
  runId: t.String(),
  sessionId: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  status: messageStatusSchema,
  startedAt: t.Number(),
  finishedAt: t.Union([t.Number(), t.Null()]),
  path: t.String(),
  recordCount: t.Number(),
  records: t.Array(traceRecordSchema),
})

export const runSnapshotEventSchema = t.Object({
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
  payload: t.Record(t.String(), t.Unknown()),
})

export const runSnapshotSchema = t.Object({
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
  events: t.Array(runSnapshotEventSchema),
})

export const completedRunSchema = t.Object({
  runId: t.String(),
  sessionId: t.String(),
  sessionTitle: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  responseBody: t.Union([t.String(), t.Null()]),
  messagePreview: t.Union([t.String(), t.Null()]),
  startedAt: t.Number(),
  finishedAt: t.Number(),
})

export const runtimeStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('pending'),
  t.Literal('streaming'),
  t.Literal('waitingForUserInput'),
  t.Literal('cancelling'),
])
export const sessionTailEventTypeSchema = t.Union([
  t.Literal('UserMessageAppended'),
  t.Literal('RunStarted'),
  t.Literal('AssistantMessageCompleted'),
  t.Literal('RunCompleted'),
  t.Literal('RunFailed'),
  t.Literal('RunAborted'),
  t.Literal('InteractionRequested'),
  t.Literal('InteractionResolved'),
  t.Literal('QueueItemEnqueued'),
  t.Literal('QueueItemClaimed'),
  t.Literal('QueueItemReleased'),
  t.Literal('QueueItemFailed'),
  t.Literal('QueueItemReordered'),
  t.Literal('QueueItemUpdated'),
  t.Literal('QueueItemCancelled'),
  t.Literal('SteerApplied'),
  t.Literal('LastTurnRolledBack'),
  t.Literal('TitleChanged'),
  t.Literal('SnapshotRequired'),
])
export const sessionTailEventSchema = t.Object({
  scope: t.Union([t.Literal('session'), t.Literal('sessions')]),
  sessionId: t.String(),
  sequenceId: t.Number(),
  version: t.Number(),
  type: sessionTailEventTypeSchema,
  occurredAt: t.Number(),
  payload: t.Record(t.String(), t.Unknown()),
})
export const providerThreadSourceKindSchema = t.Union([
  t.Literal('cli'),
  t.Literal('vscode'),
  t.Literal('exec'),
  t.Literal('appServer'),
  t.Literal('subAgent'),
  t.Literal('subAgentReview'),
  t.Literal('subAgentCompact'),
  t.Literal('subAgentThreadSpawn'),
  t.Literal('subAgentOther'),
  t.Literal('unknown'),
])

export const providerThreadSchema = t.Object({
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
  cwd: t.Union([t.String(), t.Null()]),
})

export const providerThreadTurnSchema = t.Object({
  id: t.String(),
  status: t.String(),
  startedAt: t.Union([t.Number(), t.Null()]),
  completedAt: t.Union([t.Number(), t.Null()]),
  durationMs: t.Union([t.Number(), t.Null()]),
  itemsView: t.String(),
  items: t.Array(t.Any()),
})

export const runtimeSessionRunSchema = t.Object({
  runId: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  status: messageStatusSchema,
  startedAt: t.Number(),
  finishedAt: t.Union([t.Number(), t.Null()]),
  modelId: t.Union([t.String(), t.Null()]),
  providerSessionId: t.Union([t.String(), t.Null()]),
  queueItemId: t.Union([t.String(), t.Null()]),
  runtimeSettings: runtimeSettingsSchema,
})

export const codexAppServerCapabilitySchema = t.Object({
  method: t.String(),
  paramsType: t.Nullable(t.String()),
  category: t.String(),
  operation: t.String(),
  interaction: t.Union([t.Literal('request'), t.Literal('stream')]),
})

export const codexAppServerServerMessageSchema = t.Object({
  method: t.String(),
  paramsType: t.String(),
  category: t.String(),
})
