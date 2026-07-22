# Relay Transport

This module owns Cradle Server to Cradle Server tunnels that pass through relayd.
It is used when the host machine cannot accept inbound connections. relayd only
verifies signed admission assertions and forwards envelopes; the Cradle servers
encrypt the inner stream end to end.

## Ownership

`relay-transport` owns:

- host-side enrollments in `relay_host_enrollments`.
- host-side X25519 key generation and private-key secret references.
- host-side Ed25519 relay assertion signing keys stored as sibling secrets.
- host-side relay-scoped HTTP auth tokens stored as sibling secrets.
- the always-on host connector that maintains `/ws/host` connections to relayd.
- the controller-side local TCP listener used by `remote-hosts`.
- the encrypted inner protocol, stream multiplexing, and flow control.

The module reads relay server URLs through `relay-servers`, but it does not write
relay server registry rows. The controller-side remote host row remains owned by
`remote-hosts`.

## Files

- `protocol.ts`: relayd envelope mirror plus the encrypted inner frame schemas.
- `crypto.ts`: X25519 key agreement, HKDF key derivation, pairing confirmation,
  public-key fingerprints, and XChaCha20-Poly1305 frame encryption.
- `session.ts`: shared controller/host handshake state machine, encrypted frame
  handling, stream multiplexing, and credit-based flow control.
- `controller-transport.ts`: controller-side WebSocket connection and local TCP
  listener. It returns the shared `LocalTunnelHandle` contract owned by
  `src/runtime/local-tunnel.ts`.
- `host-connector.ts`: host-side background service. It recreates relay rooms,
  connects to `/ws/host`, reconnects with backoff, and bridges streams to this
  server's local HTTP port.
- `host-enrollment-service.ts`: host-side enrollment CRUD and `pairing/start`
  orchestration.
- `index.ts` and `model.ts`: Elysia routes and TypeBox schemas under
  `/relay-transport`.

## Pairing Flow

On the host Cradle Server, call:

    POST /relay-transport/host-enrollments

with a relay URL. The host generates an X25519 keypair, stores the private key
as a managed secret, generates a separate Ed25519 signing key sibling secret,
asks relayd `POST /pairing/start` for a pairing code with a signed
`create_room` assertion, and stores an enrollment row. The response includes a
pairing string:

    <pairingCode>:<roomId>#<hostKeyFingerprint>

On the controller Cradle Server, create or update a remote host with
`transport: "relay"` and a relay URL or relay server id, then call:

    POST /remote-hosts/:hostId/relay/claim

with the pairing string. The controller generates or reuses its X25519
encryption key and Ed25519 signing key, claims the room with a signed `claim`
assertion, performs the first encrypted handshake, verifies that the learned
host public key matches the fingerprint in the pairing string, and stores the
pinned host key plus its own controller encryption key reference in the remote
host connection config.

After this, normal remote-host connect calls use pinned public keys and do not
need the pairing code again.

The first handshake also carries the controller Ed25519 signing public key in
the controller `hello` metadata. The host stores it as a sibling secret so
`POST /rooms/host-session` can restore relayd's in-memory controller
authorization after relayd restarts. This keeps existing X25519 pinning fields
unchanged and avoids a database migration.

Each host enrollment also has a relay-scoped HTTP auth token stored as a managed
system secret. The token is not exposed through enrollment read APIs. When a
controller opens a tunneled stream, the host connector rewrites the first
HTTP/1 request header on that local TCP stream to include
`x-cradle-relay-token`. The server auth boundary accepts that token only while
the enrollment row still exists, so deleting the enrollment revokes the tunneled
credential even if the managed secret remains on disk.

## Runtime Tunnel

The controller side opens a local listener on `127.0.0.1:<port>` and returns
`localBaseUrl` to `remote-hosts`. The upstream gateway at
`/remote-hosts/:hostId/upstream/*` then forwards HTTP bytes into that local
socket; they become encrypted `stream_data` frames over relayd and exit on the
host side as a TCP connection to the host Cradle Server's own local HTTP port.

The binary v2 stream protocol uses 64 KiB maximum data chunks and starts each
stream at a 512 KiB unacknowledged credit window. Send-side credit
(`peerAckedBytes` / `bytesInFlight`) and receive-side progress
(`appliedBytes` / `ackedToPeerBytes`) are tracked separately on each stream —
HTTP request and response share one `streamId` and must not corrupt each
other's windows. After sustained successful application acknowledgements, the
sender may grow its bounded window up to 8 MiB. The receiver only emits
cumulative `stream_ack` frames after the local transport has applied the bytes
(TCP write success), typically every 64 KiB, so a slow consumer cannot inflate
the peer's send window. A separate 16 MiB connection-wide cap bounds the sum
of all streams' in-flight data, so concurrent transfers cannot multiply the
per-stream maximum without limit.

## Performance checkpoints and benchmark

`RelayControllerTransportHandle.getPerformanceSnapshot()` records a bounded,
in-memory timeline for each controller tunnel: connection attempt start,
WebSocket open, encrypted handshake ready, local listener ready, and the
open/first-request-byte/first-response-byte/close timestamps for recent
streams. It retains no HTTP path, header, or payload bytes.

`GET /remote-hosts/:hostId/cradle-server/health` exposes this timeline as
`relayPerformance` for Relay transports; other transports return `null`. A
remote host is `warming` while its startup connection promise is pending.

Run the reproducible Old/New model with:

    pnpm --filter @cradle/server benchmark:relay

It prints a named Run, Markdown table, and machine-readable JSON for codec
bytes, FIFO-versus-priority scheduling, and bounded-window behavior at several
RTTs. Run `pnpm --filter @cradle/server benchmark:relay:runtime` for the
separate real-relayd cold/warm timestamp sample. The latter is a local sample,
not an Internet-latency forecast.

Pairing codes are returned on create (as `pairingString`) and may be re-read
only via `GET .../pairing-string` while the enrollment is still pairable.
List/get responses expose a boolean `pairable` flag and never embed the raw
code. Deleting an enrollment stops the host connector, drops the row (so the
relay auth token stops matching), and removes sibling secrets (host key,
signing key, relay auth token, controller signing pubkey).

## CLI

Routes in this module expose generated CLI commands under:

    cradle relay-transport host-enrollment ...

The create command is intended for headless host machines because it prints the
pairing string that must be entered on the controller.

## Validation

Focused validation:

    pnpm --filter @cradle/server exec vitest run tests/relay-transport --reporter=dot
    go test ./...

The server test starts a real relayd subprocess and verifies pairing, an HTTP
request through the tunnel, and pinned-pubkey reconnect.
