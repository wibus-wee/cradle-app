import { useEffect, useRef } from 'react'

import type { ServerConnection } from './api'
import { cradleStreamResponse } from './api'

interface GlobalSessionEvent {
  scope?: string
  sequenceId?: number
  type?: string
}

const RECONNECT_DELAY_MS = 5_000
const REFRESH_COALESCE_MS = 100

function readSseLine(buffer: string, streamEnded: boolean): { line: string, rest: string } | null {
  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index]
    if (character === '\n') {
      return { line: buffer.slice(0, index), rest: buffer.slice(index + 1) }
    }
    if (character === '\r') {
      if (index + 1 >= buffer.length && !streamEnded) { return null }
      const lineEnd = buffer[index + 1] === '\n' ? index + 2 : index + 1
      return { line: buffer.slice(0, index), rest: buffer.slice(lineEnd) }
    }
  }
  return null
}

/** Consume valid, increasing global session events from a fetch-backed SSE response. */
export async function consumeSessionSummaryEventStream(
  response: Response,
  afterSequenceId: number,
  onEvent: (event: GlobalSessionEvent & { scope: 'sessions', sequenceId: number }) => void,
): Promise<void> {
  if (!response.body) { throw new Error('Session event tail has no response body.') }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let sequenceId = afterSequenceId

  const processLine = (line: string) => {
    if (line === '') {
      const data = dataLines.join('\n')
      dataLines = []
      if (!data) { return }
      try {
        const event = JSON.parse(data) as GlobalSessionEvent
        if (
          event.scope === 'sessions'
          && typeof event.sequenceId === 'number'
          && event.sequenceId > sequenceId
        ) {
          sequenceId = event.sequenceId
          onEvent({ ...event, scope: 'sessions', sequenceId: event.sequenceId })
        }
      }
      catch {
        // A malformed frame must not tear down an otherwise healthy event tail.
      }
      return
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  try {
    while (true) {
      const next = await reader.read()
      buffer += decoder.decode(next.value, { stream: !next.done })
      let parsed = readSseLine(buffer, next.done)
      while (parsed) {
        processLine(parsed.line)
        buffer = parsed.rest
        parsed = readSseLine(buffer, next.done)
      }
      if (next.done) { break }
    }
    if (dataLines.length > 0) { processLine('') }
  }
  finally {
    reader.releaseLock()
  }
}

/** Refresh bounded mobile summary queries from the durable global event tail. */
export function useSessionSummaryEvents(
  connection: ServerConnection | null,
  enabled: boolean,
  onChanged: () => void,
): void {
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  useEffect(() => {
    if (!connection || !enabled) { return }
    const activeConnection = connection
    let stopped = false
    let sequenceId = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let abortController: AbortController | null = null

    const scheduleRefresh = () => {
      if (refreshTimer !== null) { return }
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        onChangedRef.current()
      }, REFRESH_COALESCE_MS)
    }

    const connect = async () => {
      abortController = new AbortController()
      try {
        const response = await cradleStreamResponse(
          activeConnection,
          `/events?scope=sessions&afterSequenceId=${sequenceId}`,
          { signal: abortController.signal },
        )
        await consumeSessionSummaryEventStream(response, sequenceId, (event) => {
          sequenceId = event.sequenceId
          scheduleRefresh()
        })
      }
      catch {
        // Reconnect from the durable cursor. Replaying the tail closes the gap;
        // refreshing here would turn an outage back into periodic polling.
      }
      finally {
        if (!stopped) { reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS) }
      }
    }

    void connect()
    return () => {
      stopped = true
      abortController?.abort()
      if (reconnectTimer !== null) { clearTimeout(reconnectTimer) }
      if (refreshTimer !== null) { clearTimeout(refreshTimer) }
    }
  }, [connection, enabled])
}
