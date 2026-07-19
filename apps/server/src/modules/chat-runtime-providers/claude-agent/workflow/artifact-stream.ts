import type { FSWatcher } from 'node:fs'
import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { AppError } from '../../../../errors/app-error'
import { createJsonlTail } from '../../../../infra/jsonl-tail'
import type { EventSubscription } from '../../../../infra/sse-event-stream'
import { extractClaudeWorkflowDeclaration } from './declaration-extractor'
import type { ClaudeWorkflowEvent } from './event-parser'
import { normalizeClaudeWorkflowRecord, parseClaudeWorkflowJsonlLine } from './event-parser'
import type { ClaudeWorkflowExecutionRecord } from './execution'
import type { ClaudeWorkflowArtifactSnapshot } from './state-reducer'
import { ClaudeWorkflowStateReducer } from './state-reducer'

export type {
  ClaudeWorkflowArtifactAgent,
  ClaudeWorkflowArtifactPhase,
  ClaudeWorkflowArtifactSnapshot,
  ClaudeWorkflowArtifactStatus,
} from './state-reducer'

/**
 * Owns provider artifact watchers and publication only. JSON shapes belong to
 * the event parser; Workflow semantics and reconciliation belong to the reducer.
 */
export class ClaudeWorkflowArtifactSource implements EventSubscription<ClaudeWorkflowArtifactSnapshot> {
  private readonly listeners = new Set<(snapshot: ClaudeWorkflowArtifactSnapshot) => void>()
  private readonly reducer: ClaudeWorkflowStateReducer
  private readonly journalTail: ReturnType<typeof createJsonlTail<ClaudeWorkflowEvent[]>>
  private readonly agentTails = new Map<string, ReturnType<typeof createJsonlTail<ClaudeWorkflowEvent[]>>>()
  private readonly declarationAbort = new AbortController()
  private readonly transcriptDir: string
  private readonly artifactPath: string | null
  private artifactWatcher: FSWatcher | null = null
  private artifactReadInFlight: Promise<void> | null = null
  private artifactReadPending = false
  private publishQueued = false
  private started = false
  private closed = false

  constructor(
    private readonly execution: ClaudeWorkflowExecutionRecord,
    private readonly onEmpty: () => void,
  ) {
    const transcriptDir = execution.output?.transcriptDir
    const runId = execution.output?.runId
    if (!transcriptDir || !runId) {
      throw new AppError({
        code: 'workflow_artifacts_unavailable',
        status: 409,
        message: 'Workflow transcript artifacts are not available for this run',
      })
    }
    this.transcriptDir = transcriptDir
    this.artifactPath = resolveWorkflowArtifactPath(execution)
    this.reducer = new ClaudeWorkflowStateReducer({
      runId,
      name: execution.output?.workflowName ?? execution.input.name,
      description: execution.input.description ?? execution.output?.summary ?? null,
      status: execution.status,
      startedAt: execution.startedAt,
    })
    this.journalTail = createJsonlTail({
      path: join(transcriptDir, 'journal.jsonl'),
      parse: line => parseClaudeWorkflowJsonlLine(line, { source: 'journal' }),
    })
  }

  async initialize(): Promise<void> {
    const hasFinalArtifact = await this.readArtifact()
    if (!hasFinalArtifact) { this.startDeclarationExtraction() }
  }

  subscribe(listener: (snapshot: ClaudeWorkflowArtifactSnapshot) => void): () => void {
    if (this.closed) { throw new Error('Cannot subscribe to a closed Workflow artifact source') }
    this.listeners.add(listener)
    if (!this.started) { this.start() }
    listener(this.reducer.snapshot())

    let unsubscribed = false
    return () => {
      if (unsubscribed) { return }
      unsubscribed = true
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.close()
        this.onEmpty()
      }
    }
  }

  close(): void {
    if (this.closed) { return }
    this.closed = true
    this.declarationAbort.abort()
    this.artifactWatcher?.close()
    this.artifactWatcher = null
    this.journalTail.close()
    for (const tail of this.agentTails.values()) { tail.close() }
    this.agentTails.clear()
    this.listeners.clear()
  }

  private start(): void {
    this.started = true
    this.journalTail.subscribe(events => this.applyEvents(events))
    this.startArtifactWatcher()
    this.queueArtifactRead()
  }

  private startDeclarationExtraction(): void {
    void extractClaudeWorkflowDeclaration(this.execution.input, { signal: this.declarationAbort.signal })
      .then((declaration) => {
        if (!declaration || this.closed) { return }
        this.reducer.apply({ kind: 'workflow-declared', declaration, observedAt: Date.now() })
        this.schedulePublish()
      })
      .catch(() => undefined)
  }

  private applyEvents(events: ClaudeWorkflowEvent[]): void {
    if (this.closed || events.length === 0) { return }
    this.reducer.applyAll(events)
    for (const event of events) {
      if (event.kind === 'agent-observed') { this.subscribeAgentTranscript(event.agentId) }
    }
    this.schedulePublish()
  }

  private subscribeAgentTranscript(agentId: string): void {
    if (this.agentTails.has(agentId) || this.closed) { return }
    const tail = createJsonlTail({
      path: join(this.transcriptDir, `agent-${agentId}.jsonl`),
      parse: line => parseClaudeWorkflowJsonlLine(line, { source: 'agent-transcript', agentId }),
    })
    this.agentTails.set(agentId, tail)
    tail.subscribe(events => this.applyEvents(events))
  }

  private startArtifactWatcher(): void {
    if (!this.artifactPath || this.artifactWatcher || this.closed) { return }
    const directory = dirname(this.artifactPath)
    const filename = basename(this.artifactPath)
    try {
      const watcher = watch(directory, (_event, changed) => {
        if (!changed || changed.toString() === filename) { this.queueArtifactRead() }
      })
      watcher.on('error', () => {
        if (this.artifactWatcher === watcher) { this.artifactWatcher = null }
        watcher.close()
      })
      this.artifactWatcher = watcher
    }
    catch {
      this.artifactWatcher = null
    }
  }

  private queueArtifactRead(): void {
    if (!this.artifactPath || this.closed) { return }
    if (this.artifactReadInFlight) {
      this.artifactReadPending = true
      return
    }
    this.artifactReadInFlight = this.readArtifact()
      .then(() => undefined)
      .finally(() => {
        this.artifactReadInFlight = null
        if (this.artifactReadPending) {
          this.artifactReadPending = false
          this.queueArtifactRead()
        }
      })
  }

  private async readArtifact(): Promise<boolean> {
    if (!this.artifactPath) { return false }
    const text = await readFile(this.artifactPath, 'utf8').catch(() => null)
    if (!text || this.closed) { return false }
    try {
      const events = normalizeClaudeWorkflowRecord(JSON.parse(text) as unknown, {
        source: 'workflow-output',
      })
      this.reducer.applyAll(events)
      this.schedulePublish()
      return events.some(event => (
        event.kind === 'workflow-observed'
        && event.status !== null
        && event.status !== 'running'
      ))
    }
    catch {
      return false
    }
  }

  private schedulePublish(): void {
    if (this.publishQueued || this.closed || this.listeners.size === 0) { return }
    this.publishQueued = true
    queueMicrotask(() => {
      this.publishQueued = false
      if (this.closed) { return }
      const snapshot = this.reducer.snapshot()
      for (const listener of this.listeners) { listener(snapshot) }
    })
  }
}

const sources = new Map<string, ClaudeWorkflowArtifactSource>()
const sourceInitializations = new Map<string, Promise<ClaudeWorkflowArtifactSource>>()

export async function getClaudeWorkflowArtifactSource(input: {
  sessionId: string
  execution: ClaudeWorkflowExecutionRecord
}): Promise<ClaudeWorkflowArtifactSource> {
  const key = `${input.sessionId}\0${input.execution.toolCallId}`
  const existing = sources.get(key)
  if (existing) { return await (sourceInitializations.get(key) ?? Promise.resolve(existing)) }
  const source = new ClaudeWorkflowArtifactSource(input.execution, () => sources.delete(key))
  sources.set(key, source)
  const initialization = source.initialize().then(() => source)
  sourceInitializations.set(key, initialization)
  try {
    return await initialization
  }
  catch (error) {
    if (sources.get(key) === source) { sources.delete(key) }
    source.close()
    throw error
  }
  finally {
    if (sourceInitializations.get(key) === initialization) { sourceInitializations.delete(key) }
  }
}

function resolveWorkflowArtifactPath(execution: ClaudeWorkflowExecutionRecord): string | null {
  const runId = execution.output?.runId
  const scriptPath = execution.output?.scriptPath ?? execution.input.scriptPath
  return runId && scriptPath ? join(dirname(dirname(scriptPath)), `${runId}.json`) : null
}
