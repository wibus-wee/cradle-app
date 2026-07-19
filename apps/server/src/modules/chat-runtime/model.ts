import { t } from 'elysia'

import { SessionModel } from '../session/model'
import {
  chatMessageSnapshotSchema,
  codexAppServerCapabilitySchema,
  codexAppServerServerMessageSchema,
  completedRunSchema,
  contextPartSchema,
  filePartSchema,
  nullableModelIdSchema,
  providerThreadSchema,
  providerThreadTurnSchema,
  queueItemSchema,
  runSnapshotSchema,
  runtimeCatalogItemSchema,
  runtimeHealthItemSchema,
  runtimeKindSchema,
  runtimeModelDescriptorSchema,
  runtimeModelSourceSchema,
  runtimeSessionRunSchema,
  runtimeStatusSchema,
  runTraceSchema,
  sessionTailEventSchema,
  slashCommandSchema,
  thinkingEffortSchema,
  traceRecordSchema,
  uiMessageSchema,
} from './model/common-schemas'
import {
  runtimeBackgroundTerminalSchema,
  runtimeContextUsageSchema,
  runtimeUiSlotSchema,
  runtimeUiSlotStateSchema,
} from './model/ui-slot-schemas'
import {
  runtimeSettingsPatchSchema,
  runtimeSettingsSchema,
  sessionClaudeAgentConfigSchema,
  sessionRuntimeSettingsPatchSchema,
} from './runtime-settings-model'

export const ChatRuntimeModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  runIdParams: t.Object({
    runId: t.String({ minLength: 1 }),
  }),

  sideConversationParams: t.Object({
    sideConversationId: t.String({ minLength: 1 }),
  }),

  completedRunsQuery: t.Object({
    since: t.Optional(t.Number({ minimum: 0 })),
    limit: t.Optional(t.Number({ minimum: 1, maximum: 200 })),
  }),

  providerThreadParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    threadId: t.String({ minLength: 1 }),
  }),

  workflowArtifactParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    toolCallId: t.String({ minLength: 1 }),
  }),

  backgroundTerminalParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    processId: t.String({ minLength: 1 }),
  }),

  draftRuntimeCapabilitiesQuery: t.Object({
    runtimeKind: runtimeKindSchema,
  }),

  sessionEventsQuery: t.Object({
    afterVersion: t.Optional(t.Number({ minimum: 0 })),
    limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
  }),

  globalEventsQuery: t.Object({
    scope: t.Literal('sessions'),
    afterSequenceId: t.Optional(t.Number({ minimum: 0 })),
    workspaceId: t.Optional(t.String()),
    limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
  }),

  providerThreadsQuery: t.Object({
    cursor: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    sortKey: t.Optional(t.Union([t.Literal('created_at'), t.Literal('updated_at')])),
    sortDirection: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
    sourceKinds: t.Optional(t.String()),
    archived: t.Optional(t.Boolean()),
    searchTerm: t.Optional(t.String()),
  }),

  providerThreadTurnsQuery: t.Object({
    cursor: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    sortDirection: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
  }),

  backgroundTerminalsQuery: t.Object({
    cursor: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
  }),

  queueItemParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    queueItemId: t.String({ minLength: 1 }),
  }),

  userInputParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    requestId: t.String({ minLength: 1 }),
  }),

  toolApprovalParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    requestId: t.String({ minLength: 1 }),
  }),

  composerDraftParams: t.Object({
    surfaceId: t.String({ minLength: 1 }),
  }),

  composerDraftPayload: t.Object(
    {
      text: t.String(),
      contextParts: t.Array(contextPartSchema),
      files: t.Array(filePartSchema),
      pastedTexts: t.Array(
        t.Object(
          {
            id: t.String({ minLength: 1 }),
            text: t.String(),
            lineCount: t.Number({ minimum: 0 }),
            charCount: t.Number({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),

  composerDraftWriteBody: t.Object(
    {
      draft: t.Object(
        {
          text: t.String(),
          contextParts: t.Array(contextPartSchema),
          files: t.Array(filePartSchema),
          pastedTexts: t.Array(
            t.Object(
              {
                id: t.String({ minLength: 1 }),
                text: t.String(),
                lineCount: t.Number({ minimum: 0 }),
                charCount: t.Number({ minimum: 0 }),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),

  composerDraftResponse: t.Object({
    surfaceId: t.String(),
    draft: t.Union([
      t.Object(
        {
          text: t.String(),
          contextParts: t.Array(contextPartSchema),
          files: t.Array(filePartSchema),
          pastedTexts: t.Array(
            t.Object(
              {
                id: t.String({ minLength: 1 }),
                text: t.String(),
                lineCount: t.Number({ minimum: 0 }),
                charCount: t.Number({ minimum: 0 }),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
      t.Null(),
    ]),
    revision: t.Number(),
    updatedAt: t.Union([t.Number(), t.Null()]),
    deletedAt: t.Union([t.Number(), t.Null()]),
  }),

  planImplementationApprovalParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    messageId: t.String({ minLength: 1 }),
  }),

  responseBody: t.Object({
    text: t.Optional(t.String()),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    messages: t.Optional(t.Array(uiMessageSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    runtimeSettings: t.Optional(runtimeSettingsPatchSchema),
  }),

  bangCommandBody: t.Object({
    command: t.String({ minLength: 1 }),
  }),

  sideChatBody: t.Object({
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
  }),

  quickQuestionBody: t.Object({
    question: t.String({ minLength: 1 }),
  }),

  userInputBody: t.Object({
    answers: t.Record(t.String(), t.Array(t.String())),
  }),

  toolApprovalBody: t.Object({
    approved: t.Boolean(),
    reason: t.Optional(t.String()),
  }),

  toolApprovalResponse: t.Object({
    requestId: t.String(),
    approved: t.Boolean(),
    reason: t.Optional(t.String()),
  }),

  planImplementationApprovalBody: t.Object({
    approvalId: t.String({ minLength: 1 }),
    approved: t.Boolean(),
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
    resultMessage: uiMessageSchema,
  }),

  cancelResponse: t.Object({
    ok: t.Literal(true),
  }),

  rollbackLastTurnResponse: t.Object({
    ok: t.Literal(true),
    sessionId: t.String(),
    messageIds: t.Array(t.String()),
    providerRuntimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    providerRolledBackTurns: t.Number(),
    fileChangesReverted: t.Literal(false),
  }),

  regeneratedTitleResponse: SessionModel.session,

  userInputResponse: t.Object({
    requestId: t.String(),
    answers: t.Record(t.String(), t.Array(t.String())),
  }),

  planImplementationApprovalResponse: t.Object({
    message: uiMessageSchema,
  }),

  runtimeSettingsBody: sessionRuntimeSettingsPatchSchema,

  runtimeSettingsResponse: t.Object({
    sessionId: t.String(),
    runtimeKind: t.String(),
    runtimeSettings: runtimeSettingsSchema,
    claudeAgent: t.Union([sessionClaudeAgentConfigSchema, t.Null()]),
    applied: t.Boolean(),
  }),

  codexAppServerCapabilities: t.Object({
    protocol: t.String(),
    generatorVersion: t.String(),
    generatedDate: t.String(),
    clientMethods: t.Array(codexAppServerCapabilitySchema),
    serverRequests: t.Array(codexAppServerServerMessageSchema),
    serverNotifications: t.Array(codexAppServerServerMessageSchema),
  }),

  codexAppServerInvokeBody: t.Object({
    method: t.String({ minLength: 1 }),
    params: t.Optional(t.Any()),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
  }),

  codexAppServerStreamBody: t.Object({
    method: t.String({ minLength: 1 }),
    params: t.Optional(t.Any()),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    closeOnMethods: t.Optional(t.Array(t.String({ minLength: 1 }))),
  }),

  codexAppServerInvokeResponse: t.Object({
    method: t.String(),
    capability: codexAppServerCapabilitySchema,
    result: t.Any(),
  }),

  runtimeCatalog: t.Object({
    items: t.Array(runtimeCatalogItemSchema),
  }),

  runtimeHealth: t.Object({
    items: t.Array(runtimeHealthItemSchema),
  }),

  sessionTailEvent: sessionTailEventSchema,

  runtimeModelsQuery: t.Object({
    workspaceId: t.Optional(t.String()),
  }),

  runtimeKindParams: t.Object({
    runtimeKind: runtimeKindSchema,
  }),

  runtimeModelCatalog: t.Object({
    runtimeKind: t.String(),
    source: runtimeModelSourceSchema,
    fetchedAt: t.Number(),
    models: t.Array(runtimeModelDescriptorSchema),
  }),

  capabilities: t.Object({
    runtimeKind: t.String(),
    slashCommands: t.Array(slashCommandSchema),
    uiSlots: t.Array(runtimeUiSlotSchema),
    skills: t.Array(t.String()),
  }),

  uiSlotStates: t.Object({
    runtimeKind: t.String(),
    states: t.Array(runtimeUiSlotStateSchema),
  }),

  contextUsageResponse: t.Object({
    sessionId: t.String(),
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    usage: t.Union([runtimeContextUsageSchema, t.Null()]),
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
      running: t.Number(),
    }),
  }),

  providerThreads: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    threads: t.Array(providerThreadSchema),
    nextCursor: t.Union([t.String(), t.Null()]),
    backwardsCursor: t.Union([t.String(), t.Null()]),
  }),

  providerThread: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    thread: providerThreadSchema,
  }),

  providerThreadDelete: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    threadId: t.String(),
    deleted: t.Literal(true),
  }),

  providerThreadTurns: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    threadId: t.String(),
    turns: t.Array(providerThreadTurnSchema),
    messages: t.Array(uiMessageSchema),
    nextCursor: t.Union([t.String(), t.Null()]),
    backwardsCursor: t.Union([t.String(), t.Null()]),
  }),

  backgroundTerminals: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    terminals: t.Array(runtimeBackgroundTerminalSchema),
    nextCursor: t.Union([t.String(), t.Null()]),
  }),

  backgroundTerminalTerminate: t.Object({
    runtimeKind: t.String(),
    providerSessionId: t.Union([t.String(), t.Null()]),
    processId: t.String(),
    terminated: t.Boolean(),
  }),

  chatMessages: t.Object(
    {
      revision: t.Number({ minimum: 0 }),
      rows: t.Array(chatMessageSnapshotSchema),
    },
    { additionalProperties: false },
  ),

  queueItem: queueItemSchema,

  queueListResponse: t.Object({
    items: t.Array(queueItemSchema),
  }),

  traceRecord: traceRecordSchema,

  runTrace: runTraceSchema,

  runSnapshot: runSnapshotSchema,

  sessionTraces: t.Object({
    sessionId: t.String(),
    traces: t.Array(runTraceSchema),
  }),

  sessionRunSnapshots: t.Object({
    sessionId: t.String(),
    snapshots: t.Array(runSnapshotSchema),
  }),

  completedRuns: t.Object({
    runs: t.Array(completedRunSchema),
  }),

  queueEnqueueBody: t.Object({
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    runtimeSettings: t.Optional(runtimeSettingsPatchSchema),
  }),

  steerBody: t.Object({
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    providerTargetId: t.Optional(t.String()),
  }),

  steerResponse: t.Union([
    t.Object({
      mode: t.Literal('steered'),
      ok: t.Literal(true),
      sessionId: t.String(),
      runId: t.String(),
      sourceMessageId: t.String(),
      message: uiMessageSchema,
    }),
    t.Object({
      mode: t.Literal('queued'),
      ok: t.Literal(true),
      sessionId: t.String(),
      queueItem: queueItemSchema,
    }),
  ]),

  queueReorderBody: t.Object({
    queueItemIds: t.Array(t.String({ minLength: 1 })),
  }),

  queueUpdateBody: t.Object({
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    contextParts: t.Optional(t.Array(contextPartSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(nullableModelIdSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    runtimeSettings: t.Optional(runtimeSettingsPatchSchema),
  }),
}
