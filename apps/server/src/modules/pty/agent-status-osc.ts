import type { PtyActivityState } from './protocol'

const OSC_AGENT_STATUS_PREFIX = '\u001B]9999;'
const MAX_PENDING_CHARS = 64 * 1024

export interface PtyAgentStatusPayload {
  state: PtyActivityState
  agent?: string
  prompt?: string
}

export interface ProcessedPtyOutput {
  cleanData: string
  statuses: PtyAgentStatusPayload[]
}

function normalizeState(value: unknown): PtyActivityState | null {
  if (value === 'working' || value === 'streaming' || value === 'thinking' || value === 'composing') {
    return 'working'
  }
  if (value === 'blocked' || value === 'waiting' || value === 'permission') {
    return 'blocked'
  }
  if (value === 'idle' || value === 'done' || value === 'complete' || value === 'completed') {
    return 'idle'
  }
  return null
}

function findTerminator(data: string, from: number): { index: number, length: 1 | 2 } | null {
  const bel = data.indexOf('\u0007', from)
  const st = data.indexOf('\u001B\\', from)
  if (bel === -1 && st === -1) { return null }
  if (bel === -1) { return { index: st, length: 2 } }
  if (st === -1 || bel < st) { return { index: bel, length: 1 } }
  return { index: st, length: 2 }
}

/** Parses the provider status side-channel used by Orca/Herdr integrations. */
export function createPtyAgentStatusOscProcessor(): (data: string) => ProcessedPtyOutput {
  let pending = ''

  return (data) => {
    const combined = pending + data
    pending = ''
    const statuses: PtyAgentStatusPayload[] = []
    let cleanData = ''
    let cursor = 0

    while (cursor < combined.length) {
      const start = combined.indexOf(OSC_AGENT_STATUS_PREFIX, cursor)
      if (start === -1) {
        const tail = combined.slice(cursor)
        let partialLength = 0
        for (let length = Math.min(OSC_AGENT_STATUS_PREFIX.length - 1, tail.length); length > 0; length -= 1) {
          if (tail.endsWith(OSC_AGENT_STATUS_PREFIX.slice(0, length))) {
            partialLength = length
            break
          }
        }
        cleanData += partialLength > 0 ? tail.slice(0, -partialLength) : tail
        if (partialLength > 0) { pending = tail.slice(-partialLength) }
        break
      }

      cleanData += combined.slice(cursor, start)
      const payloadStart = start + OSC_AGENT_STATUS_PREFIX.length
      const terminator = findTerminator(combined, payloadStart)
      if (!terminator) {
        const candidate = combined.slice(start)
        pending = candidate.length <= MAX_PENDING_CHARS ? candidate : ''
        break
      }

      try {
        const parsed: unknown = JSON.parse(combined.slice(payloadStart, terminator.index))
        if (typeof parsed === 'object' && parsed !== null) {
          const record = parsed as Record<string, unknown>
          const state = normalizeState(record.state)
          if (state) {
            statuses.push({
              state,
              ...(typeof record.agentType === 'string' && record.agentType ? { agent: record.agentType } : {}),
              ...(typeof record.prompt === 'string' && record.prompt ? { prompt: record.prompt } : {}),
            })
          }
        }
      }
      catch {
        // A malformed private status payload must never break terminal output.
      }

      cursor = terminator.index + terminator.length
    }

    return { cleanData, statuses }
  }
}
