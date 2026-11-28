# Kero transport & connectivity study

Research on https://github.com/egoist/kero (shallow clone, HEAD of default branch at study time). File paths below are inside the kero repo. Kero is a terminal app for coding agents: a desktop GUI + `kero` CLI on the operator machine, `kerod` daemons on local and remote hosts. Sessions (pty processes) live in `kerod`, never in the app.

Legend: **[observed]** = read directly in the code/docs cited; **[inferred]** = conclusion drawn from the code, not stated anywhere.

---

## 1. Remote connectivity architecture

### 1.1 One multiplexed connection per host

**[observed]** The GUI and CLI open **one connection per host** and multiplex every logical use over it — sidebar state subscription, per-pane terminal attach streams, file browsing, admin operations. `internal/proto/remote.go`: "reaches kerod through one connection: an SSH or WSL session running `kero __bridge` on the host, or one of kerod's network listeners… then carries streams (yamux)".

- Mux library: `github.com/hashicorp/yamux v0.1.2`. Each yamux stream carries the exact same protocol a local client uses on kerod's unix socket: one JSON-line `Hello` ("control" or "attach"), then either JSON-line RPC or binary terminal frames (`internal/proto/proto.go`, `internal/proto/frame.go`).
- Two independent version numbers: `MuxVersion = 1` for the mux handshake and `proto.Version = 3` for the daemon protocol. The mux layer deliberately "changes far less often than the protocol it carries, so that a client still talks to a host of another protocol, to tell the user so and to update it" — the mux carries `host.restart` / `host.update` streams answered regardless of protocol version.

### 1.2 Transport plugability

**[observed]** `internal/remote/transport.go` `transport()` dispatches on address scheme:

| Scheme | What happens |
|---|---|
| `ssh://` or bare `user@host[:port]` | spawns **the system `ssh` binary** (no Go SSH library anywhere in `go.mod`) with `-T -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o ClearAllForwardings=yes`, running `kero __bridge` on the host |
| `wsl://` | `wsl.exe --exec sh -c <bridge script>` |
| `http://host:port` | WebSocket (`github.com/coder/websocket`) to `/kero/mux`, but **only to tailnet IPs or loopback** — enforced in `dialTailnet` which refuses anything not in `100.64.0.0/10`, `fd7a:115c:a1e0::/48`, or loopback |
| `https://` | WebSocket over TLS to kerod behind Tailscale Serve |

The interface between transport and protocol is just `io.ReadWriteCloser`. For process transports, `cmdConn` wraps ssh/wsl.exe stdin+stdout with careful lifecycle handling.

### 1.3 The SSH bridge — zero setup on the host

**[observed]** Nothing listens on the network for SSH hosts. `kero __bridge` runs `remote.Server` on its **stdin/stdout** and splices each yamux stream into a fresh unix-socket connection to the local kerod — starting kerod on demand if it isn't running.

Notable details:

- **Binary discovery**: `BridgeLocations` — ~9 candidate paths tried with `command -v`; exit 127 = "not installed", mapped to `ErrNotInstalled` and the app offers "Install Kero…" (`install-server.sh` piped over SSH, batch mode).
- **Windows shell probing**: first connection tries `sh -c`; stderr pattern matching decides whether the host uses `cmd` or `powershell`, cached in a `sync.Map`; failure evicts and re-probes.
- **Garbage tolerance**: `readWelcome` skips up to 100 junk lines before the `{"mux":` welcome JSON because shell startup files print noise.
- **No interactive auth ever**: `BatchMode=yes`; passphrase keys must come from the agent. Stderr is parsed to classify `ErrAuth` vs `ErrNotInstalled` vs other — error *classification* drives UI remediation.

### 1.4 Tailscale integration — orchestration, not embedding

**[observed]** No `tailscale.com` Go module in `go.mod`; **no tsnet**. `internal/tailscale/tailscale.go` talks to the *system* tailscaled two ways:

1. tailscaled's local API over its unix socket, plain HTTP `localapi/v0/status` and `localapi/v0/whois`;
2. fallback: shelling out to the `tailscale` CLI (`status --json`, `whois --json`).

kerod's tailnet listener is an ordinary `net.Listen("tcp", <tailscale-ip>:port)` — NAT traversal, encryption (WireGuard), hole punching and relaying (DERP) are **entirely delegated to the tailnet**: plain HTTP on the wire, since "WireGuard encrypts between tailnet devices".

**Identity & authz come from tailscaled**: per-connection `whois` on the source IP (cached 30s) gives login name / tags; authorization = machine owner plus `listen-allow` entries. Two listener kinds: `tailnet://:7373` direct TCP on tailnet IPs; `tailnet-serve://` behind `tailscale serve` (injects `Tailscale-User-Login` headers). Funnel requests (`Tailscale-Funnel-Request` header) are **rejected outright** — internet exposure deliberately refused.

**CSRF-style hardening**: any request with an `Origin` header or without the `Kero-Client` header is refused, so no web page on the tailnet can drive kerod through a browser. Local connections are refused on the tailnet listener because any local process could claim the machine's tailnet IP as source; the unix socket has proper peer-uid checking instead.

### 1.5 Reconnect / backoff logic

**[observed]** Client-side: local kerod max 4 retries; remote retry forever with exponential backoff `min(1s << min(retries-1, 6), 1min)`; classified errors (`ErrNotInstalled`/`ErrAuth`) drop to flat 1-minute poll. Dead-link detection at the mux layer: yamux `KeepAliveInterval = 5s`, `ConnectionWriteTimeout = 20s` — "a dropped connection, as a laptop's that slept, shows as reconnecting within seconds". On link loss: host stays in sidebar faded, attachments dropped and reattach lazily; control connection resubscribes. A generation counter invalidates superseded connection attempts.

### 1.6 Daemon lifecycle model

**[observed]** kerod is single-instance (`kerod.lock`); clients auto-start it on demand, preferring installed service managers. **Idle exit**: kerod exits after 30s with no sessions and no clients — unless it runs as a service or has network listeners. On restart: sessions/scrollback serialized (`state.json` + `sessions/<id>.vt`) and the next kerod relaunches shells and replays scrollback. `host.restart` answers the RPC *first*, then saves state and stops.

---

## 2. Transport stability techniques

### 2.1 State-mirroring instead of stream-replay — the core design

**[observed]** Kero's most important stability decision: **no sequence numbers, no replay buffers, no resumable byte streams anywhere**. Authoritative state lives in the daemon in regenerable form:

1. **Terminal content**: kerod runs a full headless terminal emulator (libghostty-vt) per pane. Each attached client gets a `terminal.Mirror`: "Frame returns the VT sequences that bring a terminal showing the frames before to what this one shows now… The first frame, and a frame after the screen took another size, start the other terminal over."
2. **Consequence**: a reconnecting client simply opens a new attach stream; the first frame is a full-screen restart frame. State after a dropped connection cannot be inconsistent because the stream was never the state.
3. **App state**: `proto.State` is "everything the daemon knows, which it sends whole on every change: there are tens of sessions, not thousands". Resync after reconnect = resubscribe = receive one fresh full state.

### 2.2 Backpressure / flow control

**[observed]** Layered mechanisms:

- **Per-attachment bounded queue**: cap **8192 frames**; non-blocking send; if full the client is disconnected and must reattach/resync. The daemon *never* blocks a session on a slow client.
- **Control connections**: cap 64; subscriber events *silently dropped* when full (state is sent whole, next event supersedes), while watcher connections are *cut off* — a per-consumer-type choice between lossy-but-live and fail-closed.
- **Yamux window cap**: `MaxStreamWindowSize = 256 KiB` "so that the pings and the other streams' frames, which wait behind a write of it, wait seconds at most on a slow link".
- **Frame size caps**: 1 MiB per output frame, 16 MiB hard bound.
- **Write deadlines**: control writes 5s; **frame batching**: 4ms coalescing delay.

### 2.3 What happens to in-flight data on a drop

**[observed]** Terminal output: nothing needs recovery — clients resync from mirror state. User input in flight: lost, treated as acceptable. RPC calls in flight: fail with "kerod went away", retried at UI layer. Mux streams die with the connection; no stream migration; everything re-handshakes.

### 2.4 Compression

**[observed]** Negotiated in the mux handshake: DEFLATE (BestSpeed) applied to the **whole mux connection**, flushed every write; terminal frames and whole-state JSON are repetitive text, compressed "several times smaller". WebSocket compression explicitly disabled because "ours is across the mux" — compressing *across* streams gets cross-stream redundancy.

### 2.5 Persistence across restarts

**[observed]** `state.json` + per-pane scrollback snapshots saved every 10s when dirty; on restore shells are relaunched and scrollback re-fed; agent CLIs can be *resumed* with their own resume commands (config-gated).

---

## 3. NAT traversal, hole punching, relays

**[observed] Kero implements none itself.** No QUIC, no UDP, no STUN/TURN, no hole punching, no relay selection logic anywhere (grep over all Go sources; `go.mod` has no QUIC/UDP deps). Instead:

- SSH path: connectivity delegated to OpenSSH — the user must already be able to ssh (direct IP, VPN, jump hosts in `~/.ssh/config`, which kero inherits for free by using the system binary).
- Tailscale path: NAT traversal, direct-vs-relayed path selection, DERP relays and WireGuard encryption all delegated to the tailnet. Kero merely binds to tailnet IPs and uses tailscaled as an identity oracle.
- There is no fallback relay of kero's own: if neither SSH nor a tailnet path exists, the host is unreachable, period.

---

## 4. Versions / stacks — custom vs library

**[observed]** SSH: system OpenSSH binary via `exec`. Muxing: hashicorp/yamux. WebSocket: coder/websocket (tailnet transport only). Compression: stdlib flate. TLS: only via tailscale serve. Terminal emulation: libghostty-vt. Custom-written: mux handshake, frame protocol, mirror/reattach logic, bridge scripts (sh/cmd/PowerShell), error classification, reconnect logic, install/update machinery. **No QUIC or UDP anywhere; everything is TCP** (or unix sockets/pipes).

---

## 5. Transferable lessons for Cradle

### Worth borrowing

1. **State-mirror instead of stream-replay (the big one).** Keep authoritative state in the daemon in resyncable form, make every consumer stream regenerable from a snapshot, drop laggard consumers freely. For Cradle: wherever node sessions/terminal output/agent state are concerned, prefer "snapshot + semantic deltas, restartable at any time" over durable ordered byte pipes. It eliminates the hardest part of relay failover because a reconnect over a *different path* (direct vs relay) is just a fresh attach — there is nothing to hand off.
2. **Bounded queues + drop-slow-consumers**, with the drop decision typed by consumer semantics: lossy-drop when the next message supersedes, disconnect when gaps are intolerable, resync-on-reattach for streams.
3. **One muxed connection per peer pair with tiny per-stream windows** so control/heartbeat traffic is never stuck behind bulk streams. Compression negotiated *across* the mux for cross-stream redundancy.
4. **Heartbeat + write-timeout at the mux layer** (5s ping / 20s write timeout) — detects half-open relayed paths that TCP keepalive wouldn't.
5. **Layer-version separation** — mux layer versioned independently of the application protocol, administrative streams answered regardless; makes remote upgrade/recovery possible across version mismatches.
6. **Bridge/indirection pattern** — network-facing component and daemon separable, same internal protocol; a connection can terminate at either, enabling direct LAN connections to bypass relay logic entirely.
7. **Error classification drives UX** — not-installed vs auth vs unreachable, with different retry policy per class.
8. **Lifecycle: exit when idle, start on demand, survive everything.**

### Does not transfer / must be built differently

1. **Tailscale-as-NAT-traversal is not available** — Cradle cannot assume users have Tailscale, which is precisely why relayd exists. The transferable bit is only the *shape*: delegate path selection to one layer, keep the app protocol path-agnostic (kero's scheme-switching `transport()` is ~60 lines).
2. **No help with direct-connection NAT traversal** — zero prior art for hole punching/relay selection in kero; borrow from Tailscale's magicsock design instead.
3. **SSH delegation model doesn't apply to the mesh data plane**, though inheriting user ssh config is a nice operator-facing escape hatch idea.
4. **Identity/auth model** — kero outsources identity; Cradle has its own (certificates). But the pattern of *binding authz to the transport identity at the edge once per connection* is worth noting.
5. **Plaintext-only-on-encrypted-underlay enforcement in the dialer** — a cheap proven policy pattern.
6. **Browser-attack hardening** — `Origin`-presence + required-custom-header checks for any local listeners.

### One-line summary

Kero's stability comes from a bet, not a mechanism: **all hard state lives in the daemon, every stream is regenerable, so transport failures are cheap** — and it buys connectivity entirely from ssh and Tailscale. Cradle can adopt the bet wholesale (it fits relay-mesh even better, since path migration becomes trivial), but must build the connectivity layer kero never needed.
