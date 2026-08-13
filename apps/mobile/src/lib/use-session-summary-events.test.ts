import { describe, expect, it, vi } from 'vitest'

import { consumeSessionSummaryEventStream } from './use-session-summary-events'

function streamResponse(source: string, boundaries: number[]): Response {
  const bytes = new TextEncoder().encode(source)
  let offset = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const size = boundaries.shift() ?? bytes.length
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  }))
}

describe('mobile session summary events', () => {
  it('parses fragmented SSE frames and ignores malformed, unrelated, and duplicate events', async () => {
    const onEvent = vi.fn()
    const response = streamResponse([
      ': cradle-event-stream-open\r\n\r\n',
      'data: not-json\r\n\r\n',
      'data: {"scope":"session","sequenceId":11}\r\n\r\n',
      'data: {"scope":"sessions","sequenceId":10,"type":"RunStarted"}\r\n\r\n',
      'data: {"scope":"sessions","sequenceId":11,"type":"RunCompleted"}\r\n\r\n',
      'data: {"scope":"sessions","sequenceId":11,"type":"RunCompleted"}\r\n\r\n',
    ].join(''), [1, 2, 7, 3, 11, 5, 13])

    await consumeSessionSummaryEventStream(response, 10, onEvent)

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'sessions',
      sequenceId: 11,
      type: 'RunCompleted',
    }))
  })
})
