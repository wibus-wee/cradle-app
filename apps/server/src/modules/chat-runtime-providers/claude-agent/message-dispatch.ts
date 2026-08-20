import type { SDKCommandsChangedMessage, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import { liveRuntimeSessionRegistry } from '../../chat-runtime/runtime-live-session-registry'
import {
  getDefaultRuntimeSettings,
  mergeRuntimeSettings,
} from '../../chat-runtime/runtime-settings'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../../chat-runtime/stream-trace'
import {
  mapClaudeAgentMessageToChunks,
  resetClaudeAgentChunkMapperForTurn,
} from './event-to-chunk-mapper'
import type { ClaudeAgentLiveSettings } from './live-settings'
import type { ClaudeAgentProviderThreadTurns } from './projection/provider-thread-turns'
import {
  mapCrewCallToSnapshot,
  readClaudeActiveProviderThreadId,
  readClaudeMessageParentToolUseId,
} from './projection/provider-thread-turns'
import type { ActiveClaudeQuery, ActiveClaudeTurn } from './provider-internals'
import { readClaudeAgentPermissionMode } from './runtime-settings'
import type { ClaudeAgentSessionArtifacts } from './session-artifacts'
import {
  writeClaudeAgentCapturedPlan,
  writeClaudeAgentCrewCall,
  writeClaudeAgentProgress,
  writeClaudeAgentTaskActivity,
  writeClaudeAgentWorkflowExecution,
} from './state-projector'
import type {
  ClaudeAgentCommandLifecycleMessage,
  ClaudeAgentWireMessage,
} from './types'

export interface ClaudeAgentMessageDispatchContext {
  liveSettings: ClaudeAgentLiveSettings
  providerThreadTurns: ClaudeAgentProviderThreadTurns
  sessionArtifacts: ClaudeAgentSessionArtifacts
  finalizeClaudeUserTurn: (
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    terminalChunk?: UIMessageChunk | null,
  ) => void
}

export class ClaudeAgentMessageDispatch {
  readonly runtimeKind = 'claude-agent' as const

  constructor(private readonly context: ClaudeAgentMessageDispatchContext) {}

  private get liveSettings(): ClaudeAgentLiveSettings {
    return this.context.liveSettings
  }

  private get providerThreadTurns(): ClaudeAgentProviderThreadTurns {
    return this.context.providerThreadTurns
  }

  private get sessionArtifacts(): ClaudeAgentSessionArtifacts {
    return this.context.sessionArtifacts
  }

  private finalizeClaudeUserTurn(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    terminalChunk?: UIMessageChunk | null,
  ): void {
    this.context.finalizeClaudeUserTurn(entry, turn, terminalChunk)
  }

  async handleClaudeSessionMessage(
    entry: ActiveClaudeQuery,
    message: ClaudeAgentWireMessage,
  ): Promise<void> {
    const turn = entry.currentTurn

    if (turn && isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: entry.runtimeSession.chatSessionId,
        runId: turn.input.runId,
        messageId: turn.traceMessageId,
        runtimeKind: this.runtimeKind,
        providerSessionId: entry.runtimeSession.providerSessionId,
        phase: 'provider_raw',
        payload: message,
      })
    }

    if (message.type === 'command_lifecycle') {
      this.handleClaudeCommandLifecycle(entry, message)
      return
    }

    if (message.type === 'system' && message.subtype === 'commands_changed') {
      entry.slashCommands = (message as SDKCommandsChangedMessage).commands
      return
    }

    if (message.type === 'system' && message.subtype === 'init') {
      this.resolveMessageLifecycleSupport(
        entry,
        message.capabilities?.includes('msg_lifecycle_v1') ?? false,
      )
    }

    this.sessionArtifacts.projectClaudeAgentRuntimeState(entry.runtimeSession, message)

    if (turn) {
      const providerThreadId = readClaudeActiveProviderThreadId(message)
      if (providerThreadId) {
        await this.providerThreadTurns.handleClaudeProviderThreadMessage(
          entry,
          turn,
          providerThreadId,
          message,
        )
        return
      }
    }

    const result = await mapClaudeAgentMessageToChunks(message, entry.mapperState)
    if (turn) {
      await this.providerThreadTurns.updateClaudeTurnProviderSession(
        entry,
        turn,
        result.sessionId,
      )
    }
    await this.providerThreadTurns.emitClaudeLiveUsageEvent(
      entry,
      message,
      turn?.effectiveModel,
      entry.mapperState.usageProjection,
    )
    for (const plan of result.capturedPlans) {
      writeClaudeAgentCapturedPlan(entry.runtimeSession, plan)
    }
    for (const progress of result.capturedTodos) {
      writeClaudeAgentProgress(entry.runtimeSession, progress)
    }
    for (const crewCall of result.capturedCrewCalls) {
      writeClaudeAgentCrewCall(entry.runtimeSession, mapCrewCallToSnapshot(crewCall))
      if (crewCall.workflow) {
        writeClaudeAgentWorkflowExecution(entry.runtimeSession, crewCall.workflow)
      }
    }
    for (const taskActivity of result.capturedTaskActivity) {
      writeClaudeAgentTaskActivity(entry.runtimeSession, taskActivity)
    }
    for (const mode of result.capturedInteractionModes) {
      const nextSettings = mergeRuntimeSettings(
        this.runtimeKind,
        entry.permissionBridgeState.runtimeSettings ?? getDefaultRuntimeSettings(this.runtimeKind),
        { permissionMode: mode.permissionMode },
      )
      const projectedMode = readClaudeAgentPermissionMode(nextSettings)
      await this.liveSettings.updateActiveQueryPermissionMode({
        runtimeSession: entry.runtimeSession,
        mode: projectedMode,
        runtimeSettings: nextSettings,
      })
      void this.liveSettings.requestRuntimePermissionModeUpdate(
        entry.runtimeSession,
        mode.permissionMode,
      )
    }

    if (turn && isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: entry.runtimeSession.chatSessionId,
        runId: turn.input.runId,
        messageId: turn.traceMessageId,
        runtimeKind: this.runtimeKind,
        providerSessionId: result.sessionId ?? entry.runtimeSession.providerSessionId,
        phase: 'mapper_output',
        payload: {
          messageType: message.type,
          chunks: result.chunks,
          sessionId: result.sessionId ?? null,
          usage: result.usage ?? null,
          assistantStarted: entry.mapperState.assistantStarted,
        },
      })
    }

    const isMainTurnResult = message.type === 'result' && !readClaudeMessageParentToolUseId(message)
    const terminalChunk = isMainTurnResult
      ? result.chunks.find(chunk => chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort')
      : undefined
    const streamedChunks = isMainTurnResult
      ? result.chunks.filter(chunk => chunk.type !== 'finish' && chunk.type !== 'error' && chunk.type !== 'abort')
      : result.chunks

    if (turn) {
      for (const chunk of streamedChunks) {
        if (chunk.type === 'text-delta' && 'delta' in chunk) {
          turn.outputTextCollector.append((chunk as { delta: string }).delta)
        }
        turn.queue.push(chunk)
        turn.hasProjectedOutput = true
        turn.deferredEmptyResult = false
      }
    }
 else {
      await this.providerThreadTurns.handleClaudeSyntheticSessionMessage(entry, message)
    }

    if (isMainTurnResult) {
      if (turn) {
        const shouldDeferEmptyMainResult = shouldDeferEmptyClaudeMainTurnResult({
          turn,
          message,
          terminalChunk,
        })
        if (shouldDeferEmptyMainResult) {
          // Keep `currentTurn` so subsequent Query messages stay on this user run.
          // Closing here (including via input-pull idle heuristics) would clear the
          // turn and reopen follow-on work as a system synthetic run.
          // Empty turns without follow-on close on the next user `streamTurn` or
          // Query teardown — never because `isWaitingForPull()` alone.
          turn.deferredEmptyResult = true
          resetClaudeAgentChunkMapperForTurn(entry.mapperState)
          return
        }
        turn.deferredEmptyResult = false
        this.finalizeClaudeUserTurn(
          entry,
          turn,
          turn.interruptRequested && message.subtype === 'error_during_execution'
            ? { type: 'abort', reason: 'user' }
            : terminalChunk,
        )
      }
      resetClaudeAgentChunkMapperForTurn(entry.mapperState)
    }
  }

  resolveMessageLifecycleSupport(entry: ActiveClaudeQuery, supported: boolean): void {
    if (entry.messageLifecycleSupported !== null) {
      return
    }
    entry.messageLifecycleSupported = supported
    entry.resolveMessageLifecycleSupport(supported)
  }

  handleClaudeCommandLifecycle(
    entry: ActiveClaudeQuery,
    message: ClaudeAgentCommandLifecycleMessage,
  ): void {
    this.resolveMessageLifecycleSupport(entry, true)
    const submitted = entry.submittedInputs.get(message.command_uuid)
    if (!submitted) {
      return
    }
    if (message.state === 'queued' || message.state === 'started') {
      submitted.state = message.state
      return
    }

    entry.submittedInputs.delete(message.command_uuid)
    liveRuntimeSessionRegistry.markNativeInputsTerminal(
      entry.runtimeSession.chatSessionId,
      [{
        queueItemId: submitted.queueItemId,
        outcome:
          message.state === 'completed'
            ? 'completed'
            : message.state === 'failed'
              ? 'failed'
              : 'cancelled',
      }],
    )
  }
}

function shouldDeferEmptyClaudeMainTurnResult(input: {
  turn: ActiveClaudeTurn
  message: SDKMessage
  terminalChunk: UIMessageChunk | undefined
}): boolean {
  const { turn, message, terminalChunk } = input
  if (turn.hasProjectedOutput || turn.interruptRequested) {
    return false
  }
  if (message.type !== 'result') {
    return false
  }
  // Failed/error results still finalize immediately.
  if (
    message.subtype === 'error_during_execution'
    || message.subtype === 'error_max_turns'
    || message.subtype === 'error_max_budget_usd'
    || message.subtype === 'error_max_structured_output_retries'
  ) {
    return false
  }
  if (terminalChunk && terminalChunk.type !== 'finish') {
    return false
  }
  return true
}
