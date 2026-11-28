# Relay Transport

This module owns the encrypted data plane between Cradle Servers that pass
through relayd. It is used when a Node machine cannot accept inbound
connections. relayd only verifies Fabric-authorized admission and forwards
opaque envelopes; the Cradle servers encrypt the inner stream end to end.

All connections are Fabric Node/link connections: a Node holds one
long-lived `/v1/ws/nodes/:nodeId` socket, and each authorized Controller opens
a short-lived `/v1/ws/controllers/:linkId` link to that Node. Enrollment and
discovery live in `modules/fabric`.

## Ownership

`relay-transport` owns:

- the Node-side connector (`node-connector.ts`) that maintains the persistent
  Fabric Node connection and demultiplexes per-link encrypted sessions to this
  server's local HTTP port.
- the demand-driven Controller link manager (`node-link-manager.ts`); a Node
  never gets a pre-opened tunnel just because it appears in the directory.
- the controller-side local TCP listener (`controller-transport.ts`) used by
  the Fabric upstream gateway.
- the encrypted inner protocol, stream multiplexing, and flow control.
- the Fabric v3 outer-envelope codec (`fabric-envelope.ts`) injected into the
  shared session state machine.

Fabric membership rows, certificates, and directory access remain owned by
`modules/fabric`; this module reads them through that module's service API.

## Files

- `protocol.ts`: Fabric Session envelope and encrypted inner frame schemas.
- `crypto.ts`: X25519 key agreement, Fabric-route-scoped HKDF key derivation,
  public-key fingerprints, and negotiated AES-256-GCM or
  XChaCha20-Poly1305 frame encryption.
- `compression.ts`: independent Zstandard chunk encoding with bounded decode
  output and raw fallback for data that does not shrink.
- `session.ts`: shared node/controller handshake state machine, encrypted frame
  handling, stream multiplexing, and credit-based flow control.
- `fabric-envelope.ts`: Fabric v3 outer route envelope (`fabricId`, `nodeId`,
  `linkId`) wrapping Fabric Session frames.
- `websocket-data.ts`: zero-copy WebSocket `RawData` views for the endpoint hot
  path.
- `websocket.ts`: shared state-aware teardown. Open sockets close gracefully;
  connecting or already-closing sockets terminate without calling the `ws`
  library's synchronously throwing CONNECTING `close()` path.
- `envelope-pipe.ts`: the minimal carriage contract for Fabric v3 envelopes —
  connect/send/close plus open/message/error/close lifecycle. Pipes carry
  complete, ordered envelopes and never reconnect, resume, or replay;
  reconnection policy belongs to the connector and transport consumers.
- `websocket-envelope-pipe.ts`: `EnvelopePipe` over a direct relayd WebSocket,
  preserving the zero-copy inbound views and state-aware teardown.
- `ipc-envelope-pipe.ts`: `EnvelopePipe` over the fabric-agent loopback IPC
  contract (`apps/relayd/protocol`, "Fabric agent IPC"): length-prefixed JSON
  auth frame first, then 4-byte big-endian length framing capped at 1 MiB.
  Inbound frames are zero-copy views whenever one TCP chunk already holds a
  complete frame; only fragmentation forces a single copy per frame.
- `controller-transport.ts`: controller-side envelope pipe connection and local
  TCP listener for one Fabric link. It returns the shared `LocalTunnelHandle`
  contract owned by `src/runtime/local-tunnel.ts`.
- `node-connector.ts`: Node-side always-on connector with reconnect backoff and
  per-link `FabricSession` demultiplexing.

## Runtime Tunnel

The controller side opens a local listener on `127.0.0.1:<port>` and returns
`localBaseUrl` to the Fabric module. The upstream gateway at
`/nodes/:nodeId/upstream/*` then forwards HTTP bytes into that local socket;
they become encrypted `stream_data` frames over relayd and exit on the Node
side as a TCP connection to the Node Cradle Server's own local HTTP port.

Fabric Session v2 negotiates one AEAD and one compression mode during its hello
exchange. AES-256-GCM with no compression is the portable baseline for native
clients. Server peers also advertise XChaCha20-Poly1305 and Zstandard; the Node
selects them only when the Controller offered them. The stream protocol uses
64 KiB maximum uncompressed chunks. With Zstandard selected, chunks of at least
1 KiB are compressed independently at level 1 only when the result is at least
64 bytes smaller. Both cipher choices are authenticated end to end and opaque
to relayd. The byte-level contract is
[`apps/relayd/protocol`](../../../../relayd/protocol/README.md).

Native Zstandard requires Node.js 22.15.0 or newer. Server bootstrap validates
that both compression and decompression APIs exist and reports the current and
minimum Node versions if the runtime is unsupported; package metadata enforces
the same minimum for development and standalone server installs.

Each stream starts with a 512 KiB unacknowledged credit window. Send-side credit
(`peerAckedBytes` / `bytesInFlight`) and receive-side progress
(`appliedBytes` / `ackedToPeerBytes`) are tracked separately on each stream —
HTTP request and response share one `streamId` and must not corrupt each
other's windows. After sustained successful application acknowledgements, the
sender may grow its bounded window up to 8 MiB. The receiver only emits
cumulative `stream_ack` frames after the local transport has applied the bytes
(TCP write success), typically every 256 KiB, so a slow consumer cannot inflate
the peer's send window. A separate 16 MiB connection-wide cap bounds the sum
of all streams' in-flight data, so concurrent transfers cannot multiply the
per-stream maximum without limit. FabricSession serves ready streams round-robin,
and relayd backpressures a saturated peer queue instead of disconnecting it;
control frames retain reserved capacity and priority. A local stream close is
deferred until every byte already accepted from the local socket has been framed;
later acknowledgements release credit and resume that drain. `stream_close`
shares the stream's ordered data lane, and relayd preserves same-stream arrival
order even for older clients that label close as control. Unrelated control
traffic can still bypass bulk data on other streams.

## Performance checkpoints and benchmark

`RelayControllerTransportHandle.getPerformanceSnapshot()` records a bounded,
in-memory timeline for each controller link: connection attempt start,
WebSocket open, encrypted handshake ready, local listener ready, and the
open/first-request-byte/first-response-byte/close timestamps for recent
streams. It retains no HTTP path, header, or payload bytes.

Run the reproducible V2 before/after model with:

    pnpm --filter @cradle/server benchmark:relay

It prints a named Run, Markdown table, and machine-readable JSON for codec
bytes, FIFO-versus-priority scheduling, and bounded-window behavior at several
RTTs. Run `pnpm --filter @cradle/server benchmark:relay:runtime` for endpoint
codec CPU throughput and deterministic bandwidth/RTT/jitter/loss scenarios.

## Validation

Focused validation:

    pnpm --filter @cradle/server exec vitest run tests/relay-transport --reporter=dot
