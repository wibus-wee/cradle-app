import { createChildLogger } from '../../../logging/logger'

const profileLogger = createChildLogger({ module: 'chat-runtime' })

export interface ChatRuntimeProfile {
  enabled: boolean
  startedAtMs: number
  streamStartedAtMs: number
  streamFinishedAtMs: number | null
  finalizeStartedAtMs: number | null
  finalizeFinishedAtMs: number | null
  memoryStarted: NodeJS.MemoryUsage | null
  memoryFinished: NodeJS.MemoryUsage | null
  finalMessageJsonBytes: number | null
}

export interface ChatRuntimeProfileRunSummary {
  sessionId: string
  runId: string
  messageId: string
  runtimeKind: string
  providerTargetId: string | null
  modelId: string | null
  terminalStatus: string | undefined
  replayChunkCount: number
  finalPartCount: number
}

export function isChatRuntimeProfileEnabled(): boolean {
  return process.env.CRADLE_CHAT_RUNTIME_PROFILE === '1'
}

export function startChatRuntimeProfile(): ChatRuntimeProfile {
  const now = performance.now()
  const enabled = isChatRuntimeProfileEnabled()
  return {
    enabled,
    startedAtMs: now,
    streamStartedAtMs: now,
    streamFinishedAtMs: null,
    finalizeStartedAtMs: null,
    finalizeFinishedAtMs: null,
    memoryStarted: enabled ? process.memoryUsage() : null,
    memoryFinished: null,
    finalMessageJsonBytes: null,
  }
}

export function recordChatRuntimeProfile(input: {
  run: ChatRuntimeProfileRunSummary
  diagnostics: unknown
  profile: ChatRuntimeProfile
}): void {
  const { run, diagnostics, profile } = input
  if (!profile.enabled) {
    return
  }

  const streamFinishedAtMs = profile.streamFinishedAtMs ?? performance.now()
  const finalizeStartedAtMs = profile.finalizeStartedAtMs ?? streamFinishedAtMs
  const finalizeFinishedAtMs = profile.finalizeFinishedAtMs ?? performance.now()
  const memoryFinished = profile.memoryFinished ?? process.memoryUsage()
  const memoryStarted = profile.memoryStarted
  profileLogger.info('chat runtime profile', {
    chatSessionId: run.sessionId,
    runId: run.runId,
    messageId: run.messageId,
    runtimeKind: run.runtimeKind,
    providerTargetId: run.providerTargetId,
    modelId: run.modelId,
    status: run.terminalStatus ?? 'streaming',
    timingsMs: {
      stream: Math.round(streamFinishedAtMs - profile.streamStartedAtMs),
      finalize: Math.round(finalizeFinishedAtMs - finalizeStartedAtMs),
      total: Math.round(finalizeFinishedAtMs - profile.startedAtMs),
    },
    memory: {
      startHeapUsed: memoryStarted?.heapUsed ?? null,
      endHeapUsed: memoryFinished.heapUsed,
      deltaHeapUsed: memoryStarted ? memoryFinished.heapUsed - memoryStarted.heapUsed : null,
      startRss: memoryStarted?.rss ?? null,
      endRss: memoryFinished.rss,
      deltaRss: memoryStarted ? memoryFinished.rss - memoryStarted.rss : null,
    },
    activeRun: {
      replayChunks: run.replayChunkCount,
      finalParts: run.finalPartCount,
      finalMessageJsonBytes: profile.finalMessageJsonBytes,
    },
    diagnostics,
  })
}
