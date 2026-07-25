import type { JsonValue } from '../contract'

const encoder = new TextEncoder()

export function encodeOpenAiEvent(event: JsonValue): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
}
