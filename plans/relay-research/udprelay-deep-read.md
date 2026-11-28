# Tailscale `net/udprelay` Deep Read — Implementation Dossier

Source: `tailscale/tailscale` git HEAD of `main`, shallow clone (read 2026-11-28).
Every claim is tagged `[fact]` (read directly in code, with file:line) or `[inference]`.
`server.go` = `net/udprelay/server.go`; `relaymanager.go` = `wgengine/magicsock/relaymanager.go`;
`endpoint.go` = `wgengine/magicsock/endpoint.go`; `magicsock.go` = `wgengine/magicsock/magicsock.go`;
`disco.go` = `disco/disco.go`. Line numbers exact for the cloned revision.

## 1. Roles and lifecycle

Three roles; one physical node can hold several at once [inference]:

- **Relay server** — a tailscaled running `udprelay.Server`: UDP socket-forwarding of opaque
  WireGuard/disco traffic between two client nodes. Does not terminate client WireGuard or disco
  identity; speaks its own disco key only for the bind handshake [fact: server.go:1-6, 69-100].
- **Relay client** — any tailscaled whose magicsock `relayManager` allocates endpoints on relay
  servers and sends/receives through them [fact: relaymanager.go:26-34].
- **Control** — distributes netmap nodes, capvers, ACL-derived `CapGrant`s, and provides DERP
  transport for allocation signaling. No explicit relay-assignment logic in the wire contract [inference].

Becoming a relay server:

- Opt-in per node: `tailscale set --relay-server-port=<PORT>` (`0` = random unused port; empty disables)
  (`cmd/tailscale/cli/set.go:94`); `ipn.Prefs.RelayServerPort` + `RelayServerStaticEndpoints` for
  NAT-fronted/LB deployments (`ipn/prefs.go:325-334`) [fact].
- Runs as `ipnext.Extension` `relayserver`, started eagerly or lazily on first allocation request;
  control can force-disable via node attr `disable-relay-server` [fact: relayserver.go:143-150, 212-234].
- Advertisement to control is a single informational bool `tailcfg.Hostinfo.PeerRelay` — no client-side
  consumer exists for relay selection [fact: tailcfg.go:990, local.go:7118].
- Server picks its own address candidates: static endpoints + local interface IPs + cloud metadata
  public IPs + STUN-discovered addresses, refreshed every 20-26s. Under hard NAT it also guesses
  `publicIP:configuredPort` assuming static port-forward [fact: server.go:455-576].

How clients learn the candidate relay set:

- **No dedicated netmap field**. Candidacy computed client-side from ACL CapGrants: a node is a
  candidate iff capver ≥ 121 AND the filter grants `peercap.RelayTarget` candidate→self
  [fact: magicsock.go:3063-3086]. `peercap.Relay` grants a peer the ability to allocate;
  `peercap.RelayTarget` marks relay candidacy (`peercap.go:57-62`).
- Self included — nodes can relay through themselves, short-circuited over the eventbus
  [fact: magicsock.go:2049-2066].

Who decides peer-relay vs DERP vs direct:

- **Entirely client-side**: discovery runs when the endpoint has no trusted direct path
  (`endpoint.go:965-1000`); rate-limited 30s, periodic refresh 1min; triggered by 3s heartbeat,
  packet send on untrusted path, or `tailscale ping`. Direct punching and relay discovery run
  **in parallel** — relay is suppressed only while a trusted direct path exists [fact].
- Control retains negative control only: `disable-relay-server` / `disable-relay-client` node attrs [fact].
- Priority in `betterAddr` (`endpoint.go:2087-2184`): **any direct UDP path unconditionally beats any
  relay path, before latency is considered**. DERP never competes — structural fallback below
  everything. Relay = strictly "better than DERP, worse than any direct UDP" [fact + inference].

## 2. Allocation handshake

Disco envelope: 6-byte magic + 32-byte sender disco key + NaCl box [fact: disco.go:6-23].
Message types (`disco.go:44-53`):

| Type | Message | Transport |
| --- | --- | --- |
| 0x04 | `BindUDPRelayEndpoint` | UDP direct to relay server, Geneve control |
| 0x05 | `BindUDPRelayEndpointChallenge` | UDP from relay server, Geneve control |
| 0x06 | `BindUDPRelayEndpointAnswer` | UDP direct to relay server, Geneve control |
| 0x07 | `CallMeMaybeVia` | DERP only, client→client |
| 0x08 | `AllocateUDPRelayEndpointRequest` | DERP only, client→relay-server-node |
| 0x09 | `AllocateUDPRelayEndpointResponse` | DERP only, relay-server-node→client |

**Phase A — allocate** (client → server node, over DERP):

1. Client sends `AllocateUDPRelayEndpointRequest` to **every candidate server in parallel**.
   Fields: `ClientDisco [2]` — sorted pair of the two endpoints' disco keys; `Generation uint32` —
   correlation nonce [fact: relaymanager.go:1038-1152; disco.go:465-475].
2. Server-node magicsock gates (DERP-only enforced): sender is known netmap peer with matching disco
   key; **sender must be one of the two ClientDisco keys**; ACL `peercap.Relay` grant sender→server
   [fact: magicsock.go:2550-2621].
3. `Server.AllocateEndpoint(discoA, discoB)`: rejects zero keys, self-keys; `ErrServerNotReady{RetryAfter: 3s}`
   if no candidates known yet; **idempotent per sorted pair** with LamportID for ordering; allocates
   Geneve VNI (1..2²⁴−1, sequential scan); precomputes disco shared secrets [fact: server.go:969-1049].
4. Response: `Generation` echo + `UDPRelayEndpoint` struct: `ServerDisco` (random per server process),
   `ClientDisco[2]`, `LamportID`, `VNI`, `BindLifetime` (30s) / `SteadyStateLifetime` (5min),
   `AddrPorts` — all server candidates [fact: disco.go:509-565; server.go:60-61].
5. Client retries once after 3s on not-ready, 10s overall timeout [fact: relaymanager.go:1036-1102].

Allocation messages are disco NaCl boxes sealed to the server *node*'s disco key, carried over DERP —
protected, but with no binding to the eventual UDP path [fact].

**Phase B — CallMeMaybeVia** (client → client, over DERP): allocator shares the full
`UDPRelayEndpoint` struct so the peer handshakes the same allocation without allocating itself.
"Direct connections take priority over CallMeMaybeVia paths" [fact: disco.go:625-656;
relaymanager.go:864-887]. Duplicate racing allocations collapse via server dedup + LamportID
comparison. Same-server+VNI as current bestAddr ⇒ no re-handshake (relay forwards one src per
client — would blackhole) [fact: relaymanager.go:758-818].

**Phase C — bind** (client → relay server, direct UDP, Geneve control `0x7A11` disco box sealed to
server disco key). Shared 72-byte `BindUDPRelayEndpointCommon`: `VNI` (must match cleartext Geneve
VNI), `Generation`, `RemoteKey` (**the other party's** disco key), `Challenge [32]byte`
[fact: disco.go:340-369]. Three-way exchange:

1. **Bind** → server replies `Challenge` = BLAKE2s-256 keyed MAC over
   `VNI‖Generation‖RemoteKey‖clientSrcAddrPort`, server-side random secret rotating every 2min
   (two generations accepted) [fact: server.go:103, 132-152, 195-220].
2. **Answer** echoes challenge; server recomputes MAC over the Answer packet's own source addr:port
   and compares — proof-of-return-routability anti-spoofing cookie pinning the binding to the exact
   observed src [fact: server.go:224-241].
3. Server state per endpoint: `connecting` → `open` (both legs bound) → `closed` [fact: server.go:356-377].

Everything malformed/unknown/mismatched silently dropped — no error messages in the handshake [fact].

**Phase D — probe**: client sends disco ping toward the peer through the relay as opaque data; pongs
are sent unconditionally; first pong ⇒ `udpRelayEndpointReady` installs the path with measured latency.
Budget: min(BindLifetime, 30s), max 10 pings [fact: relaymanager.go:634-651, 734-744, 929-958].

## 3. Relay data plane

- Geneve fixed 8-byte header (RFC8926, no TLV options): protocol `0x7A11` = disco, `0x7A12` = WireGuard;
  `Control` bit distinguishes bind handshake (terminates on server) from forwarded data
  [fact: net/packet/geneve.go:12-25].
- Dispatch by **VNI alone** → one `serverEndpoint` = one unordered client pair with two binding slots
  [fact: server.go:96-100, 779].
- Forwarding symmetric and pinned: `from == boundAddrPorts[0]` → forward verbatim (Geneve header
  included, never rewritten) to slot 1, and vice versa; any other source dropped. Server is oblivious
  to payload type [fact: server.go:287-320].
- Unknown VNI drop; data before both legs bound drop; GC every 30s: unbound allocations die at
  `bindLifetime` (30s), bound die when **either** leg is silent for `steadyStateLifetime` (5min)
  [fact: server.go:328-340, 742-783].
- STUN binding requests (deliberately non-overlapping with Geneve reserved bits) are answered by the
  embedded netchecker, never forwarded — the relay doubles as a STUN server [fact: server.go:767-773].
- Up to min(16, GOMAXPROCS) SO_REUSEPORT sockets per address family, 7 MiB buffers, ICMP error
  immunity, SO_MARK on Linux so relay traffic never routes over the TUN [fact: server.go:599-706].
- GRO-split/re-coalesce batching with per-destination write batching; cross-family forwarding via the
  other socket [fact: server.go:833-920].
- **Server does zero MTU management**; client-side accounting adds Geneve header length on VNI paths,
  relay paths start at SafeWireMTU, padded disco pings can probe MTU later [fact].

## 4. Authorization and abuse controls

- **The relay server itself implements zero ACL, rate limit, byte cap, or quota.** Rejects only closed
  server, zero keys, self-keys, unready state. Hard resource bound = VNI space + expiry GC
  [fact: server.go:969-989, 106-108].
- Real gate is upstream: known peer + sender-in-pair + ACL `cap/relay` grant. Prevents allocating
  relay sessions between two arbitrary victims [fact: magicsock.go:2587-2613].
- Renewal: **none exists** — allocations refresh passively through traffic; clients re-allocate after
  expiry; duplicates collapse while alive [fact: server.go:991-1013].
- Residual abuse surface: authorized-but-malicious peer can burn memory/VNI slots at allocation rate
  for up to 30s per unbound allocation; no in-tree defense beyond expiry. The k8s deployment model
  uses dedicated tagged relay nodes — blast-radius isolation, not quotas [inference].

## 5. Interaction with direct punching

- Relay paths are ordinary `epAddr{ap: relayServerAddrPort, vni}` — never the peer's own address.
  Peermap holds **at most one relay epAddr per node key** [fact: endpoint.go:2054-2063;
  peermap.go:41-51, 213-225].
- Strict ordering: direct > relay > DERP. `udpRelayEndpointReady` installs only if bestAddr untrusted,
  same server (forced migration), or wins `betterAddr` [fact: endpoint.go:110-136].
- Steady state: 3s heartbeat pings ride the relay path Geneve-encapsulated; pongs refresh
  `trustBestAddrUntil = now + 6.5s` exactly like direct paths [fact: endpoint.go:930-945, 2037-2046].
- A late successful direct punch displaces the relay path instantly on next direct pong
  [fact: endpoint.go:2018-2046].
- Trust over relayed paths is TxID-matching only — no src verification; security comes from bind
  handshake + WireGuard [fact + inference].

## 6. Failure and failover

- **DERP mirroring is the failover mechanism**: trusted bestAddr ⇒ UDP only; untrusted ⇒ "send over
  DERP and also UDP if available" — traffic duplicated onto DERP the instant trust expires (6.5s),
  zero additional failover latency; WireGuard replay protection dedups mirrors [fact: endpoint.go:635-652].
- Relay-server expiry/offline is silent — detection = pong silence. Recovery on next heartbeat/send,
  rate-limited 30s, full sweep 1min. Failover granularity ≈ 6.5-10s, DERP covers the gap
  [fact + inference].
- Finding a direct path does not cancel in-flight relay work — handshakes expire on their own 30s
  timers [fact].
- Socket write errors ⇒ bestAddr cleared; network change ⇒ bestAddr + endpoint state cleared. Relay
  server process exits entirely on socket read error ("at least until socket re-binding is
  implemented") [fact: endpoint.go:1887-1911; server.go:829-841].
- Server disco keys are per-process random — restart = new key = all allocations dead [fact + inference].

## 7. Mapping table — tailscale concept → Cradle fabric analog

| tailscale concept | Cradle fabric analog | Notes |
| --- | --- | --- |
| disco keypair (semi-ephemeral X25519) | cert-bound X25519 `encryptionPubkey` | cert-pinned: better audit, control-channel FS caveat — data keys already session-derived |
| disco NaCl box | X25519 ECDH + AEAD control frames, or extend Fabric Session v2 framing (kinds 8+ free) | session-v2 construction already has exactly this shape |
| Geneve + VNI per pair | v3 envelope route fields or a new random per-allocation binding id | reusing raw linkId in cleartext UDP headers enables correlation — prefer random binding id |
| binding (sorted pair + 2 pinned src slots) | same structure keyed by fabric member ids | stronger audit than ephemeral keys |
| challenge/answer BLAKE2s MAC over src addr:port | copy verbatim — keyed MAC/AEAD echo token | needed the moment UDP exists; TCP was implicitly return-routable |
| `Hostinfo.PeerRelay` bool | capability string in join request, distributed via directory + SSE | mechanism exists end-to-end already |
| `peercap.Relay`/`RelayTarget` CapGrants | fabric grants + **new byte/duration caps** — no tailscale counterpart exists to copy | grants are already per-node rows in relayd's store |
| candidate set computed client-side from ACLs | relayd directory computes and distributes server-side via SSE | simpler — relayd is already centralized and curates per-controller node lists |
| DERP fallback + signaling transport | existing relayd WebSocket path, unchanged | plays exactly the DERP role: floor + signaling |
| allocation over DERP | authenticated directory call or WS control frame; design fork: relayd-mediated vs volunteer-node-local allocation | node-local matches tailscale's semi-trusted model better |
| VNI lifetimes (bind 30s / steady 5min) | same constants as starting point | refreshed by 3s heartbeats in tailscale |
| heartbeat 3s / trust 6.5s / sweep 1min / rate-limit 30s | no existing equivalent — proven starting constants | — |
| DERP mirroring during untrusted windows | mirror onto UDP + WS paths during migration; dedup via v3 `sequence`/`ack` — much cleaner than WireGuard-level dedup | v3's dead seq/ack fields are the extension point |
| `betterAddr` strict ordering + hysteresis scoring | direct-UDP > peer-relay-UDP > relayd-WS; copy scoring nearly verbatim | battle-tested constants |
| hard-NAT guessed `publicIP:fixedPort` advertisement | worth stealing for volunteer nodes behind port-forwards | server.go:548-556 |
| self-allocation | mostly N/A — Cradle relay sessions are always exactly one Node + one Controller | star topology removes peer-consent complexity |

## Appendix

- `tailscale ping` reports relayed paths as `{ip}:{port}:vni:{vni}` [fact].
- Metrics: direct vs peer-relay packet/byte counts per family; relay server per-leg counters
  [fact: magicsock.go:100-150; net/udprelay/metrics.go].
- Debug tooling: `tailscale debug peer-relay-sessions` live per-VNI counters via LocalAPI [fact].
- Relay server embeds a netcheck client needing a DERP map solely for STUN self-discovery [fact].
- Capvers: 120 = disco messages + client/server functions; 121 = allocation protocol [fact].
