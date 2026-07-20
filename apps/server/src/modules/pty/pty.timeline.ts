import type {
  PtyExitEvent,
  PtyExitState,
  PtyOutputEvent,
  PtyRestoreInfo,
  PtySnapshotEvent,
  PtyTimelineEvent,
} from './protocol'

const MAX_BUFFER_BYTES = 512 * 1024
const MAX_EVENT_COUNT = 2048

type TimelineSubscriber = (event: PtyTimelineEvent) => void

interface TimelineRecord {
  seq: number
  buffer: string
  running: boolean
  exit: PtyExitState | null
  restore: PtyRestoreInfo | null
  events: PtyTimelineEvent[]
  subscribers: Set<TimelineSubscriber>
}

export type PtyReplayResult
  = | { ok: true, events: PtyTimelineEvent[] }
    | { ok: false, snapshot: PtySnapshotEvent }

export class PtyTimelineStore {
  private readonly sessions = new Map<string, TimelineRecord>()

  reset(sessionId: string): void {
    const existing = this.sessions.get(sessionId)
    existing?.subscribers.clear()
    this.sessions.set(sessionId, {
      seq: 0,
      buffer: '',
      running: true,
      exit: null,
      restore: null,
      events: [],
      subscribers: new Set(),
    })
  }

  ensureSession(sessionId: string): TimelineRecord {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return existing
    }

    const record: TimelineRecord = {
      seq: 0,
      buffer: '',
      running: true,
      exit: null,
      restore: null,
      events: [],
      subscribers: new Set(),
    }
    this.sessions.set(sessionId, record)
    return record
  }

  setRestore(sessionId: string, restore: PtyRestoreInfo | null): void {
    const record = this.ensureSession(sessionId)
    record.restore = restore
  }

  seedBuffer(sessionId: string, ansi: string): void {
    if (!ansi) {
      return
    }
    const record = this.ensureSession(sessionId)
    if (record.buffer.length > 0) {
      return
    }
    record.buffer = trimBuffer(ansi)
  }

  getBuffer(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.buffer ?? null
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.running ?? false
  }

  appendOutput(sessionId: string, data: string): PtyOutputEvent {
    const record = this.ensureSession(sessionId)
    record.seq += 1
    record.buffer = trimBuffer(record.buffer + data)
    record.running = true
    record.exit = null

    const event: PtyOutputEvent = {
      type: 'output',
      seq: record.seq,
      data,
    }

    record.events.push(event)
    trimEvents(record.events)
    this.publish(sessionId, event)
    return event
  }

  appendExit(sessionId: string, exit: PtyExitState): PtyExitEvent {
    const record = this.ensureSession(sessionId)
    record.seq += 1
    record.running = false
    record.exit = exit

    const event: PtyExitEvent = {
      type: 'exit',
      seq: record.seq,
      exitCode: exit.exitCode,
      signal: exit.signal,
    }

    record.events.push(event)
    trimEvents(record.events)
    this.publish(sessionId, event)
    return event
  }

  snapshot(sessionId: string): PtySnapshotEvent | null {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return null
    }

    return {
      type: 'snapshot',
      seq: record.seq,
      buffer: record.buffer,
      running: record.running,
      ...(record.restore ? { restore: record.restore } : {}),
    }
  }

  latestExitEvent(sessionId: string): PtyExitEvent | null {
    const record = this.sessions.get(sessionId)
    if (!record?.exit || record.running) {
      return null
    }

    return {
      type: 'exit',
      seq: record.seq,
      exitCode: record.exit.exitCode,
      signal: record.exit.signal,
    }
  }

  since(sessionId: string, fromSeq: number): PtyReplayResult | null {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return null
    }

    if (record.events.length === 0) {
      return { ok: true, events: [] }
    }

    const oldestSeq = record.events[0]?.seq ?? 0
    if (fromSeq < oldestSeq - 1) {
      return { ok: false, snapshot: this.snapshot(sessionId)! }
    }

    return {
      ok: true,
      events: record.events.filter(event => event.seq > fromSeq),
    }
  }

  subscribe(sessionId: string, subscriber: TimelineSubscriber): () => void {
    const record = this.ensureSession(sessionId)
    record.subscribers.add(subscriber)

    return () => {
      const current = this.sessions.get(sessionId)
      if (!current) {
        return
      }
      current.subscribers.delete(subscriber)
    }
  }

  delete(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return
    }

    record.subscribers.clear()
    this.sessions.delete(sessionId)
  }

  clear(): void {
    for (const record of this.sessions.values()) {
      record.subscribers.clear()
    }
    this.sessions.clear()
  }

  private publish(sessionId: string, event: PtyTimelineEvent): void {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return
    }

    for (const subscriber of record.subscribers) {
      subscriber(event)
    }
  }
}

export const ptyTimeline = new PtyTimelineStore()

function trimBuffer(value: string): string {
  if (value.length <= MAX_BUFFER_BYTES) {
    return value
  }
  return value.slice(value.length - MAX_BUFFER_BYTES)
}

function trimEvents(events: PtyTimelineEvent[]): void {
  if (events.length <= MAX_EVENT_COUNT) {
    return
  }
  events.splice(0, events.length - MAX_EVENT_COUNT)
}
