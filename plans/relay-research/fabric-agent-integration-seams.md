# fabric-agent integration seams — audit of the existing data plane

Read-only audit with file:line evidence. Facts marked **[fact]** when directly observable in
cited code, **[inference]** where derived. Benchmarks were executed locally during the audit.

## 1. Envelope I/O interface — where v3 bytes enter/leave the TS process

Three cleanly separated layers: the v3 envelope codec
(`packages/fabric-protocol/src/fabric-envelope.ts`), the transport-agnostic session state machine
(`packages/fabric-protocol/src/session.ts` — `FabricSession` at line 211, commented "The session
is transport-agnostic: it emits outbound bytes via `send` and inbound stream events via
callbacks"), and the WebSocket carriage (`node-connector.ts`, `controller-transport.ts`) — the
seam fabric-agent must replace.

**Node side** (`node-connector.ts`): one long-lived WS to `/v1/ws/nodes`; inbound at lines 99-100
(`handleEnvelope(relayWebSocketDataView(data), …)`); outbound via `send` at line 152. Demux by
`linkId`; frames for unknown linkId are **fatal** (`fabric_link_not_open`, line 135) — `link_open`
must strictly precede data. Each incoming stream becomes a loopback TCP connection to the
server's own HTTP port (line 165).

**Controller side** (`controller-transport.ts` + `node-link-manager.ts`): per-link WS to
`/v1/ws/controllers/:linkId`; inbound at lines 237-245 with strict `(fabricId, nodeId, linkId)`
route validation; outbound at lines 205-211. `FabricNodeLinkManager.ensure` opens links on
demand: `openNodeLink` → auth headers → `startRelayControllerTransport`; consumers are the
upstream proxy (`fabric/index.ts:116-124`), workspace service (`service.ts:834,1301`), work
node-projection (`node-projection.ts:61,99`).

**Minimal transport contract** [inference anchored in code]:

1. **Reliable, ordered, lossless, exactly-once delivery.** `frame.seq !== flow.receivedBytes` at
   `session.ts:706` is fatal — a single dropped/reordered chunk kills the link. **Corollary: UDP
   needs its own reliability layer (QUIC-class); raw UDP cannot be exposed.**
2. Message-boundary preserving framing — each WS binary message is exactly one v3 envelope.
3. `link_open` before data; `hello` before encrypted frames (`session.ts:303-310`).
4. Control frames may overtake unrelated bulk data, but stream-close must not overtake
   same-stream data (relayd scheduler preserves this).
5. Close semantics: pre-handshake close = retryable setup failure; post-ready close = tunnel
   death surfaced via `onExit`. No reconnect/resume/replay exists anywhere.
6. Transport must not buffer unboundedly — relayd's 64-envelope/4 MiB per-connection cap is the
   reference budget.

**Zero-copy interlock** [fact]: `relayWebSocketDataView` returns views over the same memory
(proven by test); `decodeFabricEnvelope` slices without copying (`payload: bytes.subarray`).
Inbound hot path copies zero times between WS buffer and decrypt. IPC replacement should preserve
this. `ack` header field is written as literal 0 and unused; `seq` increments per envelope but is
unconsumed by relayd. Outer `streamId` duplicates the encrypted inner one purely so relays can
schedule fairly.

## 2. Control-plane dependencies before envelopes flow

Sequence: `openNodeLink` POSTs `/v1/nodes/:id/links` with controller cert+proof → relayd verifies
scope+grant, mints `lnk_*`, calls `FabricHub.OpenLink` which requires the node connected on its
node WS, starts `time.AfterFunc(15m)` and enqueues `link_open` carrying the controller cert to
the node. Node independently re-verifies the cert (`assertFabricCertificate` + scope check)
before creating its FabricSession. Controller WS connect is itself the claim.

**The 15-minute deadline is an unconditional hard lifetime cap** [fact]: `fabric_hub.go:93` —
`expires.Stop()` appears only in revocation paths, never on claim. Every fabric link, even
healthy active ones, is killed at 15 minutes; the TS side survives only because links re-open on
demand with no resumed state.

Module split: `modules/fabric` owns membership rows, certificates, keys, directory HTTP,
`openNodeLink`; `relay-transport` owns everything after linkId issuance; relayd owns linkId
generation, the timer, admission, `link_open` delivery.

**Direct path and link issuance — Option A (recommended): reuse `POST /v1/nodes/:id/links`**
because the linkId scopes session key derivation (`salt = fabricId ‖ 0x00 ‖ linkId`), certificate
delivery already works both directions, and revocation fan-out/presence already exist — with the
node WS kept as control-only channel. Caveats: `OpenLink` 503s when node WS absent; the 15-min
cap applies unless fixed; a direct-path claim step must present the controller cert + proof bound
to the linkId so the node's TS layer can repeat its existing verification (agent stays
crypto-blind). **Option B (separate direct establishment) rejected**: loses lifecycle governance
and revocation fan-out — a security regression — and buys nothing since relayd is always the
trust anchor anyway.

## 3. Desktop process management

`startManagedRelay` (`server-process.ts:356`): prefs `relaySource: managed|external`; port from
8787-8790; launch resolution `CRADLE_RELAYD_PATH` env → bundled `resources/relayd/<platform>-<arch>/`
→ dev `go run`; spawn via fork-shim `spawnManagedProcess` with stdin death pact
(`CRADLE_RELAYD_EXIT_ON_STDIN_CLOSE`); health = `/healthz` poll 15s; logs forwarded to console
only. **No restart policy** — on crash it only logs and the server never re-learns the URL (the
`MAX_RESTARTS=3` logic applies only to the TS server process). Env injection into server:
`CRADLE_RELAYD_PUBLIC_URL/ACCESS_MODE/PID` — used only for introspection, not the data plane.
`build-desktop-resource.mjs` cross-compiles `CGO_ENABLED=0` for darwin/linux/windows × arm64/amd64;
electron-builder ships the tree via `extraResources`; **Windows is a shipped platform** (NSIS+zip).

A second managed process fits the machinery trivially, but as a data-plane component fabric-agent
needs real supervision. Binary-vs-subcommand analysis: relayd already runs in two incompatible
roles (per-machine desktop-local vs external shared host); the fabric-agent role matches only the
first; process coupling would inflate blast radius on a binary with zero restart supervision;
external-relay topologies need a local agent regardless — so separate-agent machinery is
unavoidable. Single-binary-two-subcommands is an acceptable packaging optimization.

## 4. Headless/self-hosted servers

[fact] No env/config relay setting exists — `relayUrl` comes only from user input (POST body or
invite code) persisted in the sqlite membership row; `CRADLE_RELAYD_*` vars are desktop
introspection only. "Standalone servers intentionally have no implicit relay" (service.ts:147-149).
But the server can absolutely spawn its own agent: `apps/server/src/infra/managed-process.ts`
fork-shim spawner is used in production for codex/ACP/kimi/opencode/plugins, and
`runtime-installation.ts` + `@cradle/download-center` is an existing download-install-spawn
pipeline for exactly this class of binary.

## 5. Local IPC precedent

[fact] Zero unix-socket/stdio IPC anywhere — all TS↔Go traffic is loopback TCP (HTTP+WS).
`LocalTunnelHandle` (`src/runtime/local-tunnel.ts`, 39 lines): `localBaseUrl` + `onExit` +
`close`; consumers only use those three. **The natural seam contract: any transport yielding a
loopback `localBaseUrl` is a drop-in replacement invisible to all consumers** [inference].

## 6. Hot-path constraints

Measured during the audit (Apple Silicon, Node v22+):

- Endpoint codec is the bottleneck: AES-256-GCM+zstd ≈ **763 MiB/s** incompressible round-trip,
  512B frames ≈ 100-108 MiB/s (AEAD fixed cost dominates) [fact, measured].
- Virtual-RTT credit model: 8 MiB transfer at adaptive 8 MiB window — 90ms @ 20ms RTT, 450ms @
  100ms, 900ms @ 200ms; fixed 512 KiB window ~3.5× slower [fact, measured].
- Loopback TCP: RTT ≈ **37µs**, throughput ≈ **5.1 GiB/s** [fact, ad-hoc microbenchmark].

Cost of one IPC hop: ≈0.35% latency at the best-case 20ms virtual RTT, nothing measurable at WAN
RTTs; pipe is ~6.7× faster than the fastest codec path [inference]. Real regression risks are
behavioral: queue caps (64/4MiB, backpressure-not-disconnect), control-priority reservation (⅛),
per-stream round-robin, same-stream close ordering — the cleartext v3 header exists precisely so
relays can do this without decrypting. Ack timing unaffected (cumulative end-to-end, 256 KiB
batching). Frame discipline: max envelope 1 MiB, max uncompressed chunk 64 KiB.

## 7. Recommendation matrix

**IPC mechanism**: **loopback TCP — recommended**. Only mechanism with in-repo precedent; works
identically on all shipped platforms. Unix sockets rejected: fatal Windows interop flaw (Node
implements them as named pipes, Go uses real AF_UNIX). stdio rejected: no re-attach, no topology
flexibility. WS-over-loopback rejected: masking overhead, unnecessary handshake. Auth via random
token in 0600 file or env injection (never command line).

**Framing**: **raw v3 envelope bytes + 4-byte BE length prefix — recommended**. Preserves the
zero-copy interlock end-to-end; envelopes self-describe routes so topology is flexible. Enforce
the 1 MiB cap.

**Connection topology**: mirror the current WS topology — one shared multiplexed connection
node-side, one per link controller-side — so lifecycle code ports nearly unchanged.

**Process topology**: **separate fabric-agent process — recommended** (crash isolation, external
relays, independent restart policy). Agent-inside-relayd rejected as primary topology. Single
binary with two subcommands = acceptable packaging optimization.

**Cross-cutting requirements**: Windows shipped → loopback TCP; IPC auth token; restart
supervision mandatory for the agent; node-side relayd WS stays as control channel (design the
agent as data-plane replacement, not relayd elimination); UDP needs QUIC-class reliability; v3
envelope contract unchanged — agent schedules on cleartext priority/streamId exactly like
relayd's peerScheduler.
