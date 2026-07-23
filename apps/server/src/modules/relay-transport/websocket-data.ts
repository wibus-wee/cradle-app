import type WebSocket from 'ws'

/** Return a zero-copy view for the normal Buffer/ArrayBuffer WebSocket paths. */
export function relayWebSocketDataView(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) {
    const combined = Buffer.concat(data)
    return new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength)
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}
