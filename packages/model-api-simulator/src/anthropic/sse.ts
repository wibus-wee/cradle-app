import type { JsonValue } from '../contract'
import { isJsonObject } from '../contract'

const encoder = new TextEncoder()

export function encodeAnthropicEvent(event: JsonValue): Uint8Array {
  if (!isJsonObject(event) || typeof event.type !== 'string') { throw new Error('Anthropic SSE event requires a string type') }
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
