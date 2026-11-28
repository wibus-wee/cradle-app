# Cradle Fabric / Relay Audit — Existing relayd Architecture vs. P2P/UDP Relaying

Audit target: `wibus-wee/cradle-app` (branch `main`).
Read-only audit. "Observed" statements have file:line evidence; "Inference" statements are reasoned conclusions from that evidence.

## 1. What exists today

### 1.1 apps/relayd (Go)

A single centralized relay daemon with five internal components, wired together in `apps/relayd/cmd/relayd/main.go:63-96`:

| Component | Path | Role |
| --- | --- | --- |
| Fabric store | `internal/fabric/store.go` | SQLite persistence: `fabrics`, `principals`, `nodes`, `node_grants`, `join_requests`, `revocations` tables (`store.go:1060-1126`). Multiple Fabrics can coexist in one relayd. |
| Directory | `internal/directory/server.go` (824 lines) | HTTP control plane: create fabric, submit/approve/reject join requests, register controllers, list nodes, SSE event feed (`server.go:382 events`), open links (`server.go:516 openLink`), WebSocket upgrade handlers (`server.go:567 nodeWebSocket`, `server.go:606 controllerWebSocket`), presence marking (`server.go:632`). The directory is the **only** component allowed to create links (comment at `main.go:78-80`). |
| Membership validator | `internal/membership/membership.go` | Verifies Ed25519-signed canonical-JSON documents (certificates, join requests, request proofs) with clock-skew bounds. |
| Relay hub | `internal/relay/fabric_hub.go` | Routes opaque v3 envelopes: one long-lived Node socket per `(fabricId, nodeId)` + many short-lived Controller links (`fabric_hub.go:24-33`). `OpenLink` delivers the Controller certificate to the Node in a `link_open` control envelope so the Node can re-verify owner signature before accepting the encrypted hello (`fabric_hub.go:67-102`). Links expire after 15 minutes of not being claimed (`fabric_hub.go:92`). |
| Per-peer scheduler | `internal/relay/scheduler.go` | See §2. |

Config surface (`internal/config/config.go:8-19`, flags at `cmd/relayd/main.go:36-47`): listen addr, public URL, SQLite path, timeouts, max frame bytes (1 MiB), queue bounds (64 envelopes / 4 MiB per connection), metrics, pprof. **No transport option exists — HTTP/WebSocket is hardwired.**

### 1.2 Fabric protocol contracts

- `apps/relayd/protocol/README.md` — language-neutral contract: membership v1 signed documents (canonical JSON field order, Ed25519), Fabric v3 envelope (24-byte header: version, kind, priority, length-prefixed `fabricId`/`nodeId`/`linkId`/`streamId`, `seq`, `ack`, payload length), Fabric Session v2 handshake.
- `packages/fabric-protocol` — TS implementation shared by server and mobile: `fabric-envelope.ts` (v3 codec), `session-codec.ts` (335 lines), `session-crypto.ts` (X25519 ECDH → HKDF-SHA512 route-scoped keys, AES-256-GCM / XChaCha20-Poly1305), `session.ts` (975 lines — full handshake state machine, stream mux, flow control). Runtime-neutral: randomness injected via `FabricProtocolRuntime`.
- `apps/server/src/modules/relay-transport/` — server-owned data plane (see `README.md` "Ownership"): `node-connector.ts` (persistent `/v1/ws/nodes/:nodeId` socket + reconnect backoff + per-link demux), `node-link-manager.ts` (demand-driven Controller links), `controller-transport.ts` (Controller-side WebSocket + loopback TCP listener), `compression.ts` (independent Zstd chunks, level 1, ≥64-byte savings, bounded decode), `session.ts` glue.

### 1.3 Crypto/handshake summary (Fabric Session v2)

Plaintext 40-byte hello with cipher/compression bit masks; Node selects exactly one of each. Keys: X25519 ECDH of certificate-bound keys → HKDF-SHA512 with `salt = fabricId || 0x00 || linkId`, separate `node-send`/`controller-send` infos (spec in `protocol/README.md` "Keys and encrypted frames"). Inner frame kinds: stream open / raw data / ack / close / zstd data, 64 KiB max uncompressed chunks. relayd sees only the outer v3 envelope — payload is end-to-end encrypted; even `streamId` exists in plaintext **only** so relayd can schedule streams fairly.

### 1.4 Application transport shape

Each Fabric stream is one byte-stream tunnel to the Node's **loopback** Cradle Server HTTP port. The Controller owns stream IDs, sends HTTP/1.x bytes, never stores a server auth token; the Node injects its own tunnel credential and strips caller-supplied relay-auth headers. The browser/UI never talks to relayd directly: `apps/server/src/modules/fabric/index.ts` exposes `ALL /nodes/:nodeId/upstream/*` proxying (HTTP/SSE) plus `upstream-websocket.ts` bridging; those bytes exit through the encrypted stream.

### 1.5 Enrollment/discovery

- Owner device creates the Fabric + owner key (`fabric/service.ts:280-291`), enrolls itself as Node + companion admin Controller.
- Other devices submit signed join requests to `POST /v1/join-requests`; relayd stores only `SHA-256(deliverySecret)`; approval is owner-driven with per-Node `view/control/approve` grants (`service.ts:345-385`). Revocation paths exist per node/controller/grant.
- Node connector restarts on membership change without server restart (`fabric/README.md` "Routing and recovery").

### 1.6 Mobile and desktop usage

- **apps/mobile**: implements a Controller client in JS: enrollment/pairing in `src/features/fabric/fabric-client.ts` (uses `@cradle/fabric-protocol`), and the full data plane in `src/lib/transport/fabric-http-transport.ts` — opens `POST /v1/nodes/{nodeId}/links`, then a React Native `WebSocket` to `wss://<relayUrl>/v1/ws/controllers/{linkId}` (`fabric-http-transport.ts:285-306`), then runs `FabricSession` as controller restricted to `aes-256-gcm` + no compression (`fabric-http-transport.ts:314-320`). No Swift fabric code exists — everything is JS over RN WebSocket.
- **apps/desktop**: spawns and owns relayd as a child process (`src/main/server-process.ts:356-436 startManagedRelay`), binary resolved from bundled resources or `go run` dev fallback (`server-process.ts:467-499`), waits on `/healthz`, injects `CRADLE_RELAYD_PUBLIC_URL`, `CRADLE_RELAYD_ACCESS_MODE`, `CRADLE_RELAYD_PID` into the server environment (`server-process.ts:563-565`). Desktop itself uses no Fabric data plane — it is the relay host + server supervisor.

## 2. Data-plane mechanics — TCP/WebSocket only

**Observed fact: the entire data plane is WebSocket-over-TCP.** Three TCP segments in series for Controller→Node traffic: (1) Controller WS → relayd, (2) relayd WS → Node, (3) Node loopback TCP → local Cradle Server. Plus the Controller-side loopback TCP listener (`controller-transport.ts`). Every envelope is a binary WS message capped at 1 MiB (`main.go:43`).

Perf-relevant pieces:

- **relayd scheduler** (`internal/relay/scheduler.go`): per-peer bounded queue (default 64 envelopes / 4 MiB). Control traffic gets reserved capacity — 1/8 of count and bytes budget (`scheduler.go:46-49`) — so bulk data can never starve control; data frames are dequeued **round-robin per streamId** for cross-stream fairness. A saturated queue doesn't disconnect the peer: senders block in `enqueueWait` on a space signal — backpressure, not drops.
- **seq/ack fields in the v3 envelope are vestigial at the relay layer**: relayd parses `Seq`/`Ack` (`fabric_envelope.go:65-68`) but nothing in relayd consumes them. The TS encoder writes `ack = 0` always. Real reliability/flow control lives inside the encrypted Fabric Session: cumulative byte-offset `stream_ack`, 512 KiB initial credit, adaptive growth to 8 MiB per stream, 16 MiB connection-wide cap, ACK emitted only after local TCP write success (`relay-transport/README.md`; `packages/fabric-protocol/src/session.ts`). **Confirmed independently by the orchestrator.**
- **Compression**: per-chunk independent Zstandard at level 1, only for chunks ≥1 KiB saving ≥64 bytes (`compression.ts`).
- **Benchmarks** (`apps/server/tests/relay-transport/`): `latency-window-benchmark.test.ts` models fixed-512 KiB vs adaptive-8 MiB windows across virtual RTTs; `adverse-network-benchmark.test.ts` deterministic bandwidth/RTT/jitter/loss scenarios. These quantify exactly the pain points a UDP/QUIC path would attack: RTT-bound windows over two TCP-in-TCP-ish hops.
- **HoL-blocking note (inference)**: because each direction of a link is one ordered WS stream, a slow consumer throttles the whole connection via backpressure. TCP HoL blocking across relayd's two hops is inherent to the design.

## 3. Existing P2P/UDP/NAT-traversal surface — none

Repo-wide grep for `quic|udp|p2p|stun|hole.?punch|derp|wireguard|tailscale` over `apps`, `packages` source:

- **Zero hits** in `apps/relayd`, `apps/server/src`, `packages/fabric-protocol`, `apps/mobile/src`, `apps/desktop` for any UDP/QUIC/STUN/hole-punching/DERP/WireGuard mechanism. **Confirmed independently by the orchestrator.**
- **Tailscale appears only as documentation/locales**: the Settings guide tells users to point the web UI at a backend reachable through a Tailscale IP (`apps/web/src/locales/default/settings.ts:463-471`). Manual user guidance, not machinery.
- No endpoint discovery beyond relayd presence; no candidate exchange, no direct-address advertisement in certificates or Node records.

## 4. Deployment surface

- **One desktop = one managed relayd.** Desktop spawns its own relayd child bound to `127.0.0.1` or the LAN interface, state in `<userData>/relayd/fabric.sqlite3`.
- **External relayd supported** but nothing federates them: each Fabric lives entirely in one relayd's SQLite; a Fabric's membership row stores exactly one `relayUrl` (mutable via `PATCH /fabric/relay-url` — migration is manual).
- **No discovery protocol**: enrollment flows take `relayUrl` as user input; the pairing QR code embeds `{version, relayUrl, fabricId, requestId, deliverySecret, expiresAt}` — the closest thing to "discovery" that exists.

## 5. Extension seams for UDP/P2P/mesh relaying

### (a) Direct UDP/QUIC links between Node and Controller

- Fabric Session frames don't care what carries v3 envelopes, but the v3 envelope header, link lifecycle (`link_open`/`link_ready` are relayd-mediated), and the 15-minute link-claim handshake assume relayd. A direct path needs: endpoint advertisement in Node records or certificates, a direct-link establishment protocol reusing the Session v2 hello verbatim, and `seq`/`ack` semantics defined (currently dead fields).
- `apps/server/src/modules/relay-transport` already abstracts "frames in/out" via `FabricSession`; a QUIC/UDP transport would slot beside `websocket.ts`. The `LocalTunnelHandle` contract and the upstream gateway are transport-agnostic already.
- NAT traversal itself has **no existing owner module** — a new seam entirely; mobile needs native UDP (RN WebSocket can't do UDP).

### (b) Nodes relaying for each other (mesh relaying)

- relayd's hub is a hard star topology; there is no envelope field for hop routing — `fabricId/nodeId/linkId` identify endpoints, not paths. Mesh relaying means either a new relay-role principal kind in membership, or treating relaying as a Node capability and tunneling relay-traffic inside existing encrypted sessions. This is the deepest architectural change: relayd itself would need to become optional or federated.
- Scheduler fairness logic (`scheduler.go`) is written per-peer and is directly reusable for a relaying Node — the most portable piece.

### (c) Relay selection / measurement

- No measurement surface exists beyond relayd's `/metrics` and the Controller-side `getPerformanceSnapshot()` timeline. The Node directory record has no network-quality fields.
- The directory's SSE event feed is a natural distribution channel for relay-quality updates. A multi-relay world requires the membership model to become a relay *set*.

### What does NOT need to change

Fabric Session v2 crypto/handshake/streaming/flow-control is transport-independent and deliberately relayd-opaque; the end-to-end argument survives any underlying transport, including untrusted peer relays — exactly the right security posture for "any computer can be a relay". The envelope `seq`/`ack` fields and the reserved byte are already-reserved extension points.

## 6. Assessment relative to the user's idea

- The user's instinct matches the evidence: Cradle has **no** relay-selection or P2P capability; there is exactly one star topology through one TCP relayd.
- The encrypted-session design is already mesh-ready in the security sense.
- Biggest gaps, in dependency order: (1) endpoint discovery/advertisement schema, (2) UDP/QUIC transport for Node and mobile (mobile hardest), (3) direct-link establishment protocol reusing Session v2, (4) relay measurement + selection, (5) multi-relay/federated directory. Items 1-3 deliver direct connections; 4-5 deliver the "auto best relay" vision.
