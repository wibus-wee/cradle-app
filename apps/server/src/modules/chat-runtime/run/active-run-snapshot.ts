import type { UIMessageChunk } from 'ai'

import { truncateSnapshotPayload } from '../message-snapshot-compaction'
import type { ActiveRun } from '../run-registry'
import { startRunSnapshot } from '../run-snapshot'
import type { TokenUsage } from '../runtime-provider-types'
import { getActiveRunReplayBufferSummary } from '../runtime-status-api'
import type { TurnOutputDiagnostics } from './output-diagnostics'
import type { ChatRuntimeProfile } from './profile'
import {
  finalizeActiveRunSnapshot as finalizeRunSnapshotEvent,
  recordActiveRunSnapshotEvent as appendActiveRunSnapshotEvent,
} from './snapshot-events'

export function startActiveRunSnapshot(
  activeRun: ActiveRun,
  input: { workspaceId?: string | null, agentId?: string | null },
): void {
  const snapshot = startRunSnapshot({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.messageId,
    providerTargetId: activeRun.providerTargetId,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    modelId: activeRun.modelId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    summary: {
      providerTargetKind: activeRun.providerTargetKind,
      queueItemId: activeRun.queueItemId ?? null,
      runtimeSettings: activeRun.runtimeSettings,
      internalContinuation: activeRun.internalContinuation ?? null,
    },
  })
  activeRun.runSnapshotId = snapshot?.id ?? null
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'run_started',
    payload: {
      providerTargetKind: activeRun.providerTargetKind,
      providerTargetId: activeRun.providerTargetId,
      modelId: activeRun.modelId,
      queueItemId: activeRun.queueItemId ?? null,
    },
  })
}

export function recordActiveRunSnapshotEvent(
  activeRun: ActiveRun,
  input: {
    phase: string
    chunk?: UIMessageChunk
    modelId?: string | null
    usage?: TokenUsage
    estimatedCostUsd?: number | null
    durationMs?: number | null
    payload?: Record<string, unknown>
  },
): void {
  appendActiveRunSnapshotEvent(activeRun, {
    ...input,
    truncatePayload: truncateSnapshotPayload,
  })
}

export function finalizeActiveRunSnapshot(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk,
  input: {
    modelId: string | null
    diagnostics: TurnOutputDiagnostics
    profile: ChatRuntimeProfile
  },
): void {
  finalizeRunSnapshotEvent(activeRun, finalChunk, {
    ...input,
    diagnostics: toDiagnosticsSnapshot(input.diagnostics),
    replayBuffer: toReplayBufferSnapshot(activeRun.runId),
    truncatePayload: truncateSnapshotPayload,
  })
}

function toDiagnosticsSnapshot(diagnostics: TurnOutputDiagnostics): Record<string, number> {
  return {
    emittedEventCount: diagnostics.emittedEventCount,
    assistantBoundaryCount: diagnostics.assistantBoundaryCount,
    assistantTextCharCount: diagnostics.assistantTextCharCount,
    reasoningTextCharCount: diagnostics.reasoningTextCharCount,
    toolInputDeltaCharCount: diagnostics.toolInputDeltaCharCount,
    toolEventCount: diagnostics.toolEventCount,
    otherOutputEventCount: diagnostics.otherOutputEventCount,
  }
}

function toReplayBufferSnapshot(runId: string): Record<string, unknown> {
  const summary = getActiveRunReplayBufferSummary(runId)
  if (!summary) {
    return { runId, active: false }
  }
  return {
    runId: summary.runId,
    active: true,
    chunkCount: summary.chunkCount,
    textDeltaCount: summary.textDeltaCount,
    reasoningDeltaCount: summary.reasoningDeltaCount,
    toolInputDeltaCount: summary.toolInputDeltaCount,
    toolOutputCount: summary.toolOutputCount,
    maxDeltaChars: summary.maxDeltaChars,
  }
}
