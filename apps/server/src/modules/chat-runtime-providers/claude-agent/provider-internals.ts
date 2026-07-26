import type { Options, Query, SessionMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage, UIMessageChunk } from 'ai'

import type {
  ProviderThreadTurn,
  RuntimeSession,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import type { AsyncEventQueue } from '../async-event-queue'
import type { createBoundedTextCollector } from '../bounded-text-collector'
import type { ClaudeAgentInputStream } from './async-input-stream'
import type { ClaudeAgentChunkMapperState, ClaudeCrewLink } from './event-to-chunk-mapper'
import type { ClaudeStderrSink } from './input-projector'
import type { ClaudeAgentPermissionBridgeState } from './permission-bridge'
import type { ClaudeAgentCommandLifecycleState } from './types'

export interface ActiveClaudeSubmittedInput {
  queueItemId: string
  messageUuid: string
  state: 'submitted' | Extract<ClaudeAgentCommandLifecycleState, 'queued' | 'started'>
}

export interface ActiveClaudeQuery {
  query: Query
  abortController: AbortController
  inputStream: ClaudeAgentInputStream
  mapperState: ClaudeAgentChunkMapperState
  taskLaunchesById: Map<string, ClaudeCrewLink>
  workflowOutputsByToolCallId: Map<string, Record<string, unknown>>
  workflowLifecyclesByToolCallId: Map<string, Array<Record<string, unknown>>>
  slashCommands: SlashCommand[] | null
  permissionBridgeState: ClaudeAgentPermissionBridgeState
  runtimeSession: RuntimeSession
  providerTargetId: string
  releaseLiveRuntimeSession: () => void
  currentTurn: ActiveClaudeTurn | null
  mainSyntheticTurn: ActiveClaudeSyntheticTurn | null
  providerThreadSyntheticTurns: Map<string, ActiveClaudeSyntheticTurn>
  providerThreadTurns: Map<string, ActiveClaudeProviderThreadTurn>
  completedProviderThreadParentOutputIds: Set<string>
  onProviderSyntheticTurnEvent: StreamTurnInput['onProviderSyntheticTurnEvent'] | null
  onUsageEvent: StreamTurnInput['onUsageEvent'] | null
  submittedInputs: Map<string, ActiveClaudeSubmittedInput>
  messageLifecycleSupported: boolean | null
  messageLifecycleSupport: Promise<boolean>
  resolveMessageLifecycleSupport: (supported: boolean) => void
  closed: boolean
  pumpRunning: boolean
  stderrSink: ClaudeStderrSink
  ultracodeEnabled: boolean
}

export interface ActiveClaudeTurn {
  input: StreamTurnInput
  queue: AsyncEventQueue<UIMessageChunk>
  traceMessageId: string
  shouldPersistSession: boolean
  effectiveModel: string | undefined
  userPromptText: string
  shouldGenerateTitle: boolean
  outputTextCollector: ReturnType<typeof createBoundedTextCollector>
  endGeneration: (error?: unknown) => void
  interruptRequested: boolean
  hasProjectedOutput: boolean
  deferredEmptyResult: boolean
}

export interface ActiveClaudeSyntheticTurn {
  providerTurnId: string
  providerThreadId: string | null
  mapperState: ClaudeAgentChunkMapperState
  onProviderSyntheticTurnEvent: NonNullable<StreamTurnInput['onProviderSyntheticTurnEvent']>
}

export interface ActiveClaudeProviderThreadTurn {
  providerThreadId: string
  providerTurnId: string
  mapperState: ClaudeAgentChunkMapperState
  terminal: boolean
}

export type ClaudeTranscriptContentBlock = {
  type: string
  text?: string
  thinking?: string
  content?: unknown
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
}

export interface ClaudeTranscriptMessagePayload {
  role?: string
  content?: string | ClaudeTranscriptContentBlock[]
  model?: string
}

export type ClaudeSubagentSessionMessage = SessionMessage & {
  timestamp?: string
  subagent_type?: string
  task_description?: string
  tool_use_result?: unknown
  message: ClaudeTranscriptMessagePayload | string
}

export interface ClaudeSubagentThreadRecord {
  agentId: string
  parentSessionId: string
  cwd: string
  messages: ClaudeSubagentSessionMessage[]
}

export interface ClaudeSubagentProjectedEntry {
  providerThreadId: string
  agentId: string
  turn: ProviderThreadTurn
  message: UIMessage
  rawMessages: ClaudeSubagentSessionMessage[]
}

export type ContextUsageRuntimeInput = Pick<
  import('../../chat-runtime/runtime-provider-types').GetContextUsageInput,
  'runtimeSession'
>

export type ActivePermissionMode = Options['permissionMode']
