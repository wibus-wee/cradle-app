import type { BackendRunSnapshotEvent } from '@cradle/db'
import { z } from 'zod'

export const COMPACTED_SUCCESS_PAYLOAD_SCHEMA = 'cradle.run-snapshot-success-metadata.v1'
export const COMPACTED_SUCCESS_PAYLOAD_PREFIX = `{"schema":"${COMPACTED_SUCCESS_PAYLOAD_SCHEMA}"`
const SnapshotPayloadSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()))

export function compactSuccessfulSnapshotEvent(
  event: BackendRunSnapshotEvent,
): BackendRunSnapshotEvent {
  if (event.chunkType === null || isCompactedSuccessPayload(event.payloadJson)) {
    return event
  }
  return {
    ...event,
    payloadJson: compactSuccessfulPayload(event.payloadJson),
  }
}

export function compactSuccessfulPayload(payloadJson: string): string {
  const parsed = SnapshotPayloadSchema.safeParse(payloadJson)
  const coalescedCount
    = parsed.success && typeof parsed.data.coalescedCount === 'number'
      ? parsed.data.coalescedCount
      : undefined
  return JSON.stringify({
    schema: COMPACTED_SUCCESS_PAYLOAD_SCHEMA,
    originalLength: payloadJson.length,
    ...(coalescedCount !== undefined ? { coalescedCount } : {}),
  })
}

export function isCompactedSuccessPayload(payloadJson: string): boolean {
  return payloadJson.startsWith(COMPACTED_SUCCESS_PAYLOAD_PREFIX)
}
