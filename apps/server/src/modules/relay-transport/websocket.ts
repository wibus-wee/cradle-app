import WebSocket from 'ws'

/**
 * Closes a relay websocket without allowing ws's asynchronous connection
 * abort error to escape after transport listeners have been removed.
 */
export function closeRelayWebSocket(ws: WebSocket): void {
  ws.removeAllListeners()
  if (ws.readyState === WebSocket.CLOSED) {
    return
  }
  // Closing a CONNECTING ws aborts its HTTP upgrade request. ws emits the
  // resulting error on the next tick, so keep one listener installed after
  // teardown to prevent it from becoming an uncaught process error.
  ws.once('error', () => {})
  ws.close()
}
