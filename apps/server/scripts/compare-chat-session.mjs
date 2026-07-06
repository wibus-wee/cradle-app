#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const sessionId = process.argv[2]
const serverUrl = readArg('--server') ?? process.env.CRADLE_SERVER_URL ?? 'http://localhost:21423'
const timeoutMs = Number(readArg('--timeout-ms') ?? 10000)

if (!sessionId) {
  console.error('Usage: node apps/server/scripts/compare-chat-session.mjs <chat-session-id> [--server http://localhost:21423] [--timeout-ms 10000]')
  process.exit(2)
}

const failures = []
const warnings = []

const messages = runCradleJson(['chat', 'messages', sessionId, '--format', 'json'])
const snapshotsPayload = runCradleJson(['chat', 'snapshot', 'session', sessionId, '--format', 'json'])
const tracesPayload = runCradleJson(['chat', 'trace', 'session', sessionId, '--format', 'json'])
const events = runCradleJson(['observability', 'events', '--chat-session-id', sessionId, '--limit', '200', '--format', 'json'])
const providerThreads = await fetchJson(`/chat/sessions/${sessionId}/provider-threads`, timeoutMs)
const uiSlotStates = await fetchJson(`/chat/sessions/${sessionId}/ui-slot-states`, timeoutMs).catch(error => ({ error: String(error?.message ?? error) }))

const snapshots = Array.isArray(snapshotsPayload?.snapshots) ? snapshotsPayload.snapshots : []
const traces = Array.isArray(tracesPayload?.traces) ? tracesPayload.traces : []
const parentToolParts = collectParentToolParts(messages)
const snapshotToolEvents = collectSnapshotToolEvents(snapshots)
const providerThreadSummaries = []
const providerThreadMessages = []
const providerThreadLiveStreams = []

if (providerThreads?.threads && Array.isArray(providerThreads.threads)) {
  for (const thread of providerThreads.threads) {
    const threadId = typeof thread.id === 'string' ? thread.id : null
    if (!threadId) {
      continue
    }
    const turns = await fetchJson(`/chat/sessions/${sessionId}/provider-threads/${encodeURIComponent(threadId)}/turns`, timeoutMs)
      .catch(error => ({ error: String(error?.message ?? error) }))
    const projectedMessages = Array.isArray(turns?.messages) ? turns.messages : []
    const nativeTurns = Array.isArray(turns?.turns) ? turns.turns : []
    projectedMessages.forEach((message, index) => {
      providerThreadMessages.push(summarizeProviderThreadMessage(threadId, message, index))
    })
    const liveStream = await fetchSseChunks(
      `/chat/sessions/${sessionId}/provider-threads/${encodeURIComponent(threadId)}/stream`,
      Math.min(timeoutMs, 1500),
    ).catch(error => ({ error: String(error?.message ?? error), chunks: [] }))
    providerThreadLiveStreams.push({
      id: threadId,
      chunkCount: liveStream.chunks.length,
      streamError: liveStream.error ?? null,
      chunks: liveStream.chunks.map(chunk => summarizeChunk(chunk)),
    })
    providerThreadSummaries.push({
      id: threadId,
      status: thread.status ?? null,
      sourceKind: thread.sourceKind ?? null,
      parentToolUseId: readString(thread, ['source', 'parentToolUseId']) ?? readString(thread, ['threadSource', 'parentToolUseId']) ?? threadId,
      preview: thread.preview ?? null,
      name: thread.name ?? null,
      createdAt: thread.createdAt ?? null,
      updatedAt: thread.updatedAt ?? null,
      projectedMessageCount: projectedMessages.length,
      nativeTurnCount: nativeTurns.length,
      turnsError: turns?.error ?? null,
    })
  }
}

checkCompletedProviderThreads()
checkToolLifecycleConsistency()
checkDuplicateReasoningParts()
checkDuplicateProviderThreadProjection()
checkCrewSlotConsistency()
checkTraceCoverage()
checkUiSlotStates()

const report = {
  sessionId,
  serverUrl,
  summary: {
    messageCount: messages.length,
    snapshotCount: snapshots.length,
    traceCount: traces.length,
    providerThreadCount: providerThreadSummaries.length,
    observabilityEventCount: Array.isArray(events) ? events.length : 0,
    failureCount: failures.length,
    warningCount: warnings.length,
  },
  failures,
  warnings,
  evidence: {
    runs: snapshots.map(snapshot => ({
      runId: snapshot.runId,
      messageId: snapshot.messageId,
      status: snapshot.status,
      providerSessionId: snapshot.providerSessionId,
      modelId: snapshot.modelId,
      eventCount: Array.isArray(snapshot.events) ? snapshot.events.length : 0,
      toolCalls: summarizeToolCalls(snapshotToolEvents.get(snapshot.runId) ?? new Map()),
    })),
    assistantMessages: messages
      .filter(message => message.role === 'assistant')
      .map(message => ({
        messageId: message.messageId,
        status: message.status,
        parts: (message.message?.parts ?? []).map(part => summarizePart(part)),
    })),
    providerThreads: providerThreadSummaries,
    providerThreadMessages,
    providerThreadLiveStreams,
    traces: traces.map(trace => ({
      runId: trace.runId,
      status: trace.status,
      recordCount: trace.recordCount,
      path: trace.path,
    })),
    observabilityEvents: Array.isArray(events)
      ? events.map(event => ({
          code: event.code,
          severity: event.severity,
          runId: event.runId,
          messageId: event.messageId,
          message: event.message,
          attrs: event.attrs,
        }))
      : [],
    uiSlotStates: uiSlotStates?.error ? { error: uiSlotStates.error } : { ok: true },
  },
}

console.log(JSON.stringify(report, null, 2))
process.exit(failures.length > 0 ? 1 : 0)

function checkCompletedProviderThreads() {
  for (const thread of providerThreadSummaries) {
    if (thread.sourceKind !== 'subAgent' || thread.status !== 'completed') {
      continue
    }
    const part = parentToolParts.get(thread.parentToolUseId)
    if (!part) {
      failures.push({
        code: 'completed_provider_thread_missing_parent_tool_part',
        expected: 'Every completed provider-native subagent thread should have a parent Agent tool part keyed by parentToolUseId.',
        actual: `No parent tool part found for completed provider thread ${thread.id}.`,
        evidence: thread,
      })
      continue
    }
    if (!['output-available', 'output-error', 'output-denied'].includes(part.state)) {
      failures.push({
        code: 'completed_provider_thread_not_reflected_in_parent_tool',
        expected: 'A completed provider-native subagent thread should be reflected on the parent Agent tool part as an output/error terminal state.',
        actual: `Parent ${part.type} ${part.toolCallId} is still ${part.state}; provider thread ${thread.id} is completed with ${thread.projectedMessageCount} projected messages.`,
        evidence: { thread, parentPart: part },
      })
    }
  }
}

function checkToolLifecycleConsistency() {
  for (const snapshot of snapshots) {
    const toolEvents = snapshotToolEvents.get(snapshot.runId)
    if (!toolEvents) {
      continue
    }
    for (const [toolCallId, lifecycle] of toolEvents) {
      if (lifecycle.hasInput && !lifecycle.hasOutput && snapshot.status !== 'running') {
        failures.push({
          code: 'terminal_run_tool_missing_output',
          expected: 'A non-running run should not leave a tool call at input-available without output/error/denied.',
          actual: `Run ${snapshot.runId} is ${snapshot.status}, but tool ${toolCallId} has input and no output phase.`,
          evidence: lifecycle,
        })
      }
      const providerThread = providerThreadSummaries.find(thread => thread.parentToolUseId === toolCallId)
      if (providerThread?.status === 'completed' && !lifecycle.hasOutput) {
        failures.push({
          code: 'completed_provider_thread_missing_snapshot_output',
          expected: 'A completed subagent provider thread should have a matching parent tool_call_output_available snapshot event.',
          actual: `Provider thread ${providerThread.id} is completed, but parent run ${snapshot.runId} has no output phase for ${toolCallId}.`,
          evidence: { providerThread, lifecycle },
        })
      }
    }
  }
}

function checkDuplicateReasoningParts() {
  for (const message of messages) {
    const parts = Array.isArray(message.message?.parts) ? message.message.parts : []
    for (let index = 1; index < parts.length; index += 1) {
      const previous = parts[index - 1]
      const current = parts[index]
      if (
        previous?.type === 'reasoning'
        && current?.type === 'reasoning'
        && typeof previous.text === 'string'
        && previous.text.length > 0
        && previous.text === current.text
      ) {
        failures.push({
          code: 'duplicate_adjacent_reasoning_part',
          expected: 'One provider reasoning block should project to one reasoning part; identical adjacent reasoning parts should be deduplicated or not emitted twice.',
          actual: `Assistant message ${message.messageId} has duplicate adjacent reasoning parts at indexes ${index - 1} and ${index}.`,
          evidence: {
            messageId: message.messageId,
            status: message.status,
            indexes: [index - 1, index],
            textChars: current.text.length,
            preview: current.text.slice(0, 160),
          },
        })
      }
    }
  }
}

function checkDuplicateProviderThreadProjection() {
  for (const message of providerThreadMessages) {
    for (let index = 1; index < message.parts.length; index += 1) {
      const previous = message.parts[index - 1]
      const current = message.parts[index]
      if (isDuplicateTextualProjection(previous, current)) {
        failures.push({
          code: 'duplicate_provider_thread_adjacent_text_part',
          expected: 'A provider-thread transcript message should project each text/reasoning block once.',
          actual: `Provider thread ${message.threadId} message ${message.messageId} has duplicate adjacent ${current.type} parts at indexes ${index - 1} and ${index}.`,
          evidence: { message, indexes: [index - 1, index], preview: current.preview },
        })
      }
    }
  }

  const byThread = groupBy(providerThreadMessages, message => message.threadId)
  for (const [threadId, messagesForThread] of byThread) {
    for (let index = 1; index < messagesForThread.length; index += 1) {
      const previous = messagesForThread[index - 1]
      const current = messagesForThread[index]
      if (previous.signature === current.signature) {
        failures.push({
          code: 'duplicate_provider_thread_adjacent_message',
          expected: 'Provider-thread transcript projection should not create adjacent duplicate UI messages from one native message.',
          actual: `Provider thread ${threadId} has adjacent duplicate projected messages at indexes ${index - 1} and ${index}.`,
          evidence: { previous, current },
        })
      }
    }
  }

  for (const stream of providerThreadLiveStreams) {
    const chunks = stream.chunks
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]
      const current = chunks[index]
      if (
        previous.type === 'text-delta'
        && current.type === 'text-delta'
        && previous.delta
        && previous.delta === current.delta
      ) {
        failures.push({
          code: 'duplicate_provider_thread_live_text_delta',
          expected: 'Provider-thread live replay should not emit the same adjacent text delta twice.',
          actual: `Provider thread ${stream.id} live replay has duplicate adjacent text-delta chunks at indexes ${index - 1} and ${index}.`,
          evidence: { streamId: stream.id, indexes: [index - 1, index], delta: current.delta.slice(0, 160) },
        })
      }
    }
  }
}

function checkCrewSlotConsistency() {
  if (uiSlotStates?.error || !Array.isArray(uiSlotStates?.states)) {
    return
  }
  const crewStates = uiSlotStates.states.filter(state => state?.kind === 'crew')
  for (const crewState of crewStates) {
    const calls = Array.isArray(crewState.calls) ? crewState.calls : []
    const agents = Array.isArray(crewState.agents) ? crewState.agents : []
    for (const thread of providerThreadSummaries) {
      const crewCall = calls.find(call => call?.id === thread.parentToolUseId)
      if (crewCall && crewCall.status !== thread.status) {
        failures.push({
          code: 'crew_slot_status_disagrees_with_provider_thread',
          expected: 'The crew UI slot should report the same terminal/running status as provider-thread metadata for the same parent tool call.',
          actual: `Provider thread ${thread.id} is ${thread.status}, but crew slot call ${crewCall.id} is ${crewCall.status}.`,
          evidence: { thread, crewCall: summarizeCrewItem(crewCall) },
        })
      }
      const crewAgent = agents.find(agent => agent?.threadId === thread.id)
      if (crewAgent && crewAgent.status !== thread.status) {
        failures.push({
          code: 'crew_slot_agent_status_disagrees_with_provider_thread',
          expected: 'The crew UI slot agent row should report the same status as provider-thread metadata for the same thread.',
          actual: `Provider thread ${thread.id} is ${thread.status}, but crew slot agent row is ${crewAgent.status}.`,
          evidence: { thread, crewAgent: summarizeCrewItem(crewAgent) },
        })
      }
    }
  }
}

function checkTraceCoverage() {
  for (const snapshot of snapshots) {
    const eventCount = Array.isArray(snapshot.events) ? snapshot.events.length : 0
    const trace = traces.find(candidate => candidate.runId === snapshot.runId)
    if (eventCount > 0 && trace && Number(trace.recordCount ?? 0) === 0) {
      warnings.push({
        code: 'empty_chat_trace_for_snapshot_with_events',
        expected: 'Chat trace records should cover provider/runtime phases when a run snapshot has recorded events.',
        actual: `Run ${snapshot.runId} has ${eventCount} snapshot events but trace recordCount is 0.`,
        evidence: { runId: snapshot.runId, tracePath: trace.path, snapshotStatus: snapshot.status },
      })
    }
  }
}

function checkUiSlotStates() {
  if (uiSlotStates?.error) {
    warnings.push({
      code: 'ui_slot_states_request_failed_or_timed_out',
      expected: 'ui-slot-states should return a bounded provider-owned state snapshot.',
      actual: uiSlotStates.error,
    })
  }
}

function summarizeProviderThreadMessage(threadId, message, index) {
  const parts = Array.isArray(message?.parts) ? message.parts.map(part => summarizePart(part)) : []
  return {
    threadId,
    index,
    messageId: message?.id ?? null,
    role: message?.role ?? null,
    parts,
    signature: JSON.stringify({
      role: message?.role ?? null,
      parts,
    }),
  }
}

function summarizeChunk(chunk) {
  if (!chunk || typeof chunk !== 'object') {
    return chunk
  }
  if (chunk.type === 'text-delta') {
    return {
      type: chunk.type,
      id: chunk.id ?? null,
      delta: typeof chunk.delta === 'string' ? chunk.delta : '',
    }
  }
  if (chunk.type === 'reasoning-delta') {
    return {
      type: chunk.type,
      id: chunk.id ?? null,
      delta: typeof chunk.delta === 'string' ? chunk.delta : '',
    }
  }
  if (typeof chunk.toolCallId === 'string') {
    return {
      type: chunk.type,
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName ?? null,
    }
  }
  return { type: chunk.type }
}

function isDuplicateTextualProjection(previous, current) {
  return (
    previous?.type === current?.type
    && ['text', 'reasoning'].includes(current?.type)
    && typeof previous.preview === 'string'
    && previous.preview.length > 0
    && previous.preview === current.preview
    && previous.textChars === current.textChars
  )
}

function groupBy(values, keyFn) {
  const grouped = new Map()
  for (const value of values) {
    const key = keyFn(value)
    const list = grouped.get(key) ?? []
    list.push(value)
    grouped.set(key, list)
  }
  return grouped
}

function collectParentToolParts(rows) {
  const parts = new Map()
  for (const row of rows) {
    const messageParts = Array.isArray(row.message?.parts) ? row.message.parts : []
    for (const part of messageParts) {
      if (typeof part?.toolCallId !== 'string') {
        continue
      }
      parts.set(part.toolCallId, {
        messageId: row.messageId,
        messageStatus: row.status,
        type: part.type,
        toolCallId: part.toolCallId,
        state: part.state ?? null,
        apiName: readString(part, ['input', 'apiName']) ?? readString(part, ['output', 'apiName']) ?? null,
        hasInput: Object.hasOwn(part, 'input'),
        hasOutput: Object.hasOwn(part, 'output'),
        hasErrorText: Object.hasOwn(part, 'errorText'),
      })
    }
  }
  return parts
}

function collectSnapshotToolEvents(rows) {
  const byRun = new Map()
  for (const snapshot of rows) {
    const byTool = new Map()
    for (const event of snapshot.events ?? []) {
      if (typeof event.toolCallId !== 'string') {
        continue
      }
      const current = byTool.get(event.toolCallId) ?? {
        runId: snapshot.runId,
        messageId: snapshot.messageId,
        toolCallId: event.toolCallId,
        toolName: event.toolName ?? null,
        phases: [],
        firstSeq: event.seq,
        lastSeq: event.seq,
        hasStart: false,
        hasInput: false,
        hasOutput: false,
        hasError: false,
      }
      current.toolName = current.toolName ?? event.toolName ?? null
      current.phases.push({ seq: event.seq, phase: event.phase, chunkType: event.chunkType })
      current.firstSeq = Math.min(current.firstSeq, event.seq)
      current.lastSeq = Math.max(current.lastSeq, event.seq)
      current.hasStart ||= event.phase === 'tool_call_started'
      current.hasInput ||= event.phase === 'tool_call_input_available'
      current.hasOutput ||= ['tool_call_output_available', 'tool_call_output_failed', 'tool_call_denied'].includes(event.phase)
      current.hasError ||= event.phase === 'tool_call_output_failed'
      byTool.set(event.toolCallId, current)
    }
    byRun.set(snapshot.runId, byTool)
  }
  return byRun
}

function summarizeToolCalls(toolEvents) {
  return Array.from(toolEvents.values(), lifecycle => ({
    toolCallId: lifecycle.toolCallId,
    toolName: lifecycle.toolName,
    hasStart: lifecycle.hasStart,
    hasInput: lifecycle.hasInput,
    hasOutput: lifecycle.hasOutput,
    hasError: lifecycle.hasError,
    phases: lifecycle.phases,
  }))
}

function summarizePart(part) {
  if (!part || typeof part !== 'object') {
    return part
  }
  if (typeof part.toolCallId === 'string') {
    return {
      type: part.type,
      toolCallId: part.toolCallId,
      state: part.state ?? null,
      apiName: readString(part, ['input', 'apiName']) ?? readString(part, ['output', 'apiName']) ?? null,
      hasInput: Object.hasOwn(part, 'input'),
      hasOutput: Object.hasOwn(part, 'output'),
      hasErrorText: Object.hasOwn(part, 'errorText'),
    }
  }
  if (typeof part.text === 'string') {
    return {
      type: part.type,
      state: part.state ?? null,
      textChars: part.text.length,
      preview: part.text.slice(0, 120),
    }
  }
  return { type: part.type }
}

function summarizeCrewItem(item) {
  if (!item || typeof item !== 'object') {
    return item
  }
  return {
    id: item.id ?? item.threadId ?? null,
    threadId: item.threadId ?? null,
    status: item.status ?? null,
    message: item.message ?? null,
    preview: item.preview ?? null,
    startedAt: item.startedAt ?? null,
    completedAt: item.completedAt ?? null,
  }
}

function runCradleJson(args) {
  const stdout = execFileSync('cradle', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '',
    },
    maxBuffer: 256 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function fetchJson(path, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await fetch(`${serverUrl}${path}`, { signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
    }
    return text ? JSON.parse(text) : null
  }
  finally {
    clearTimeout(timer)
  }
}

async function fetchSseChunks(path, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const decoder = new TextDecoder()
  let text = ''
  try {
    const response = await fetch(`${serverUrl}${path}`, { signal: controller.signal })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`)
    }
    const reader = response.body?.getReader()
    if (!reader) {
      return { chunks: [] }
    }
    try {
      while (true) {
        const read = await reader.read()
        if (read.done) {
          break
        }
        text += decoder.decode(read.value, { stream: true })
      }
      text += decoder.decode()
    }
    catch (error) {
      if (!controller.signal.aborted) {
        throw error
      }
    }
    return { chunks: parseSseChunks(text), aborted: controller.signal.aborted }
  }
  finally {
    clearTimeout(timer)
  }
}

function parseSseChunks(text) {
  const chunks = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue
    }
    const data = line.slice('data:'.length).trim()
    if (!data || data === '[DONE]') {
      continue
    }
    chunks.push(JSON.parse(data))
  }
  return chunks
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return null
  }
  return process.argv[index + 1] ?? null
}

function readString(value, path) {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return null
    }
    current = current[key]
  }
  return typeof current === 'string' ? current : null
}
