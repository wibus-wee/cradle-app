/**
 * EnvelopePipe — the minimal carriage contract for Fabric v3 envelopes.
 *
 * One pipe carries complete, ordered, reliable v3 envelopes in both
 * directions, mirroring the relayd WebSocket layout it abstracts:
 *
 * - Node role: one long-lived pipe multiplexing every link (like
 *   `/v1/ws/nodes`).
 * - Controller role: one pipe per link (like `/v1/ws/controllers/:linkId`).
 *
 * Lifecycle semantics intentionally match the `ws` WebSocket behavior the
 * connector and controller transport were written against:
 *
 * - Construction starts connecting. Handlers are fixed at construction and
 *   never detach except through `teardown()`.
 * - `onOpen` fires exactly once when the pipe becomes writable, or never.
 * - `send()` while the pipe is not open silently drops the bytes; the caller's
 *   flow-control layer treats the peer as not yet draining (the Fabric Session
 *   credit window is the only backpressure mechanism, exactly as with the
 *   WebSocket carriage).
 * - `onError` may fire zero or more times and is always followed by `onClose`
 *   exactly once. `onClose` without a prior `onError` is a clean or silent
 *   peer close. There is no reconnect, resume, or replay inside a pipe:
 *   reconnection policy belongs to the consumer.
 * - `close()` asks the transport to close gracefully when open and aborts a
 *   still-connecting pipe; events still flow to the handlers.
 * - `teardown()` detaches every handler and closes the transport quietly. It
 *   exists for consumer shutdown paths that must not let a late transport
 *   error escape — the same role `closeRelayWebSocket` plays for raw sockets.
 *
 * Failure semantics: a close before the consumer considers the link
 * established is a retryable setup failure; a close after establishment is
 * link death. The pipe does not distinguish them — consumers do.
 */
export interface EnvelopePipe {
  /** True only while outbound bytes will actually be written. */
  readonly open: boolean
  /** Queue one complete v3 envelope. Drops silently when not open. */
  send: (data: Uint8Array) => void
  /** State-aware close; events still reach the handlers. */
  close: (code?: number, reason?: string) => void
  /** Detach handlers and close quietly. Idempotent. */
  teardown: () => void
}

export interface EnvelopePipeHandlers {
  onOpen?: () => void
  /**
   * One complete inbound v3 envelope. The bytes are zero-copy views over
   * transport memory where the underlying carriage allows it; consumers must
   * treat them as ephemeral and copy if they outlive the synchronous delivery.
   */
  onMessage?: (data: Uint8Array) => void
  /**
   * The transport-level handshake was explicitly rejected. WebSocket
   * implementations fire this for a non-101 upgrade response; IPC
   * implementations never do (a rejected auth frame is an immediate close).
   * Diagnostic only — the close/error lifecycle still completes normally.
   */
  onRejected?: (info: { statusCode: number | null }) => void
  onError?: (error: Error) => void
  /**
   * Terminal event. `code`/`reason` mirror WebSocket close semantics; IPC
   * implementations report `null` and a static reason because TCP has no
   * close-code channel.
   */
  onClose?: (code: number | null, reason: string) => void
}
