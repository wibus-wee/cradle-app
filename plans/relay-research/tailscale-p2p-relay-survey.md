# Tailscale-style P2P + Relay: A Survey for Cradle Fabric Design

**Purpose**: inform a redesign of Cradle's connectivity layer. Today `apps/relayd`
is a centralized Go relay: Nodes and Controllers connect to it over WebSocket/TCP,
and relayd forwards opaque Fabric envelopes that it cannot decrypt — end-to-end
encryption lives in the Fabric Session layer owned by `apps/server/src/modules/relay-transport`.
The design idea under evaluation (user's words):
*任意电脑都有可能是中继，自动调配，发现最好中继点，以此来中继* — any node may act as a
relay, with automatic discovery and best-relay selection.

**Conventions**: every claim is tagged **[fact]** with a citation, or **[inference]**.
Tailscale citations refer to a shallow clone of `tailscale/tailscale` at rev `d486755`
(examined 2026-11; paths relative to repo root). Line numbers approximate; verify before quoting in implementation docs.

---

## 1. NAT traversal in Tailscale

### 1.1 NAT categories

Tailscale's netcheck classifies NATs by behavior rather than the classic cone taxonomy:

- **Easy NAT** = endpoint-independent mapping (typical Linux routers, most home gateways).
- **Hard NAT** = endpoint-dependent mapping (pfSense/OPNsense-style, some enterprise firewalls).
  **[fact]** — `tstest/natlab/vnet/nat.go`.

Detection: netcheck sends STUN probes to *multiple* STUN servers. If the observed external
address varies by destination server, `Report.MappingVariesByDestIP = true` — hard NAT.
**[fact]** — `net/netcheck/netcheck.go` L101–103, L645–667, L729.

The `Report` also records `UDP`, `IPv4/IPv6`, `UPnP/PMP/PCP` availability, `PreferredDERP`,
per-region latencies, observed global endpoints. Endpoints observed only once are excluded
(likely hard-NAT artifacts); endpoints seen 2+ times are kept. **[fact]** — L96–131, L128–167.

Hairpinning is **no longer probed**. **[fact]** — L334–338.

### 1.2 Hole punching flow

1. Each endpoint object pings all known candidate addresses of the peer over UDP.
2. On first ping it sends a **`CallMeMaybe` disco message over DERP** (never over UDP)
   carrying the sender's freshly re-STUNed endpoint list. The STUN probe immediately before
   the CallMeMaybe recreates the NAT mapping so the advertised port is live *right now*.
   Control-plane endpoint data is too stale, so endpoints are exchanged peer-to-peer.
   **[fact]** — `wgengine/magicsock/endpoint.go` L1428–1463; `disco/disco.go` `CallMeMaybe` doc L185–213.
3. `handleCallMeMaybe` merges/replaces the peer's endpoint set. **[fact]** — endpoint.go L2174–2235.
4. Pongs carry the observed source address ("effectively a STUN response"); a valid pong
   promotes that UDP path to the trusted best address. **[fact]** — disco.go L239–243.

### 1.3 Hard-NAT techniques and the birthday paradox

- **Birthday-paradox port guessing**: **not present in the current tree** — zero hits for
  "birthday" at rev `d486755`. **[fact — negative result]**. Appears replaced by (a) the
  fixed-port trick and (b) the newer UDP-relay-server machinery (`net/udprelay`, disco types
  0x04–0x09). **[inference]**
- **Fixed-port candidate**: if `MappingVariesByDestIP == true` and tailscaled listens on an
  explicit port, magicsock advertises `<wan-ip>:<local-fixed-port>` as `EndpointSTUN4LocalPort`.
  **[fact]** — `wgengine/magicsock/magicsock.go` L1363–1372; `tailcfg/tailcfg.go` L1421.
- NAT mapping lifetime probed with heartbeat pings; re-STUN on a randomized 20–26s timer,
  just under the common ~30s UDP NAT timeout, plus on network-change events.
  **[fact]** — endpoint.go L161–169; magicsock.go L918–937.

### 1.4 IPv6, UPnP, NAT-PMP, PCP

- `net/portmapper` — UDP port mapping over NAT-PMP, UPnP, PCP; 250ms probe timeouts,
  re-verify every 10 minutes. **[fact]** — portmapper.go L1–7, L105–112.
- Portmapped addresses advertised as `EndpointPortmapped`; STUN-derived as `EndpointSTUN`;
  global IPv6 advertised directly. **[fact]** — netcheck.go L750–773; magicsock.go L1347–1362.
- Full netcheck at most every 5 minutes; incremental probes only the 3 fastest regions plus
  home DERP (force-included to avoid flapping, issue #13969). **[fact]** — L1374–1379, L438–441.

### 1.5 Success rates

No numeric hole-punching success rates documented in the repo. **[fact — negative result]**.
Public figures are marketing-grade. **[inference]**

---

## 2. DERP relaying

### 2.1 Protocol shape

DERP is a TCP/WebSocket-friendly relay protocol forwarding packets addressed by curve25519
public keys — explicitly "a last resort" for when no direct UDP path exists. Server keepalives
at least every 60s. **[fact]** — `derp/derp.go` L1–14, L41–68.

### 2.2 Best-relay selection

- netcheck measures latency (STUN when UDP works; HTTPS + ICMP fallback otherwise) to every
  DERP region. **[fact]** — netcheck.go L996–1050.
- `PreferredDERP` computed from report history; control plane can steer via
  `HomeParams.RegionScore`. **[fact]** — L1426–1520.
- **Hysteresis/stickiness constants** **[fact]** — netcheck.go L1380–1405:
  - `preferredDERPAbsoluteDiff = 10ms` — never switch for less than 10ms improvement.
  - Percentage rule: keep old region unless new best is better than ~⅔ of old latency.
  - `PreferredDERPFrameTime = 8s` — frames received within 8s count as "still working".
  - `PreferredDERPKeepAliveTimeout = 2 × 60s` — keep current region if keepalives recently heard.
- magicsock refuses to change home DERP while disconnected from control — peers learn the
  home region *through* control. **[fact]** — `wgengine/magicsock/derp.go` L160–168.
- Failover: DERP connections auto-reconnect; dead bindings closed on network changes.
  **[fact]** — derphttp_client.go L54; derp.go L867–926.

### 2.3 How peers learn relay assignments

- Control plane distributes `tailcfg.Node.HomeDERP` in the network map; magicsock dials
  `DerpMagicIPAddr:HomeDERP`; a client may connect to several regions simultaneously.
  **[fact]** — tailcfg.go L427–438, L1153–1156; endpoint.go L1760–1784.

**Key structural observation [inference]**: the coordination server is *only* a directory and
measurement oracle. It never touches data-plane traffic. This is exactly the role Cradle's
relayd already plays for enrollment.

---

## 3. Disco protocol and key exchange

- Wire format: magic `TS💬` + sender disco key + nonce; payload is a **NaCl box** sealed to
  the recipient's disco key. **[fact]** — `disco/disco.go` L4–21.
- Message types: `Ping` 0x01, `Pong` 0x02, `CallMeMaybe` 0x03, plus 0x04–0x09 for UDP-relay
  allocation. **[fact]** — disco.go L39–50.
- Disco keys are independent curve25519 keys, distinct from WireGuard node keys; learned
  through the network map. **[fact]** — types/key/disco.go L30–83.
- **The same encrypted disco packet is sent verbatim over UDP or DERP** — the relay path is
  just a transport. `CallMeMaybe` goes only over DERP. **[fact]** — magicsock.go L2077–2179.
- **E2E encryption under relaying, two layers**: disco signaling is NaCl-boxed peer-to-peer;
  data is WireGuard-encrypted regardless of path. **[fact]**
- **[inference for Cradle]**: same separation Cradle already has. What disco adds is a
  *path-negotiation* channel that is itself end-to-end encrypted, so even signaling can
  traverse untrusted relays.

---

## 4. "Any node can be a relay" — systems that actually do it

Tailscale does **not** classically do this (DERPs are infrastructure) — but see §7.4:
`net/udprelay` now lets ordinary Tailscale nodes serve as UDP relays.

### 4.1 libp2p Circuit Relay v2

- **hop** protocol — `RESERVE` (become my relay) and `CONNECT`; **stop** — relay→destination leg. **[fact]**
- **Reservation**: signed voucher with expiry; node must keep its relay connection open;
  no relay chains. **[fact]**
- **Bandwidth accounting**: `Limit{duration, data}` per connection per direction; strictly
  local — no cross-network metering or reputation. **[fact]**
- **Discovery**: DHT/rendezvous/observed addresses; AutoRelay self-selects. **[fact/inference]**
- Abuse control rests on per-relay quotas + ACLs + expiring reservations. **[inference]**

### 4.2 TURN (RFC 8656)

- Allocations with 5-minute permission expiry; quota refusals; operator-run with credential
  auth; no discovery; no community pool. **[fact + inference]**

### 4.3 Syncthing relays

- Anyone can run `strelaysrv` and join the public pool at `relays.syncthing.net`; capacity
  crowdsourced but discovery centralized. Only accounting: operator per-session rate limit.
  **[fact]**; E2E encryption removes snooping value. **[inference]**

### 4.4 Yggdrasil

- Every node is a router in a cooperative mesh; no accounting. Not a fit for a commercial
  platform, but instructive as the extreme end. **[fact + inference]**

### 4.5 ZeroTier moons/roots

- Roots are ordinary nodes at stable addresses; users can run moons; nodes opt in via `orbit`.
  Roots orchestrate NAT piercing AND relay. No open pool, no automatic discovery, no accounting;
  the root set is a trust whitelist. **[fact + inference]**

### 4.6 Cross-system synthesis

| System | Who relays | Discovery | Accounting | Abuse control |
|---|---|---|---|---|
| libp2p relay v2 | Any node granting reservations | DHT/rendezvous; self-selected | Per-connection duration + byte caps | Relay-side quotas, ACLs, vouchers |
| TURN | Dedicated operator servers | Static config + credentials | Per-allocation quotas | Authentication |
| Syncthing | Volunteer community relays | Central pool server | Operator rate limit only | None formal |
| Yggdrasil | Every node (routing) | Manual / LAN multicast | None | Cooperative-mesh assumption |
| ZeroTier | Planet + opt-in moons | Explicit orbit config | None | Root whitelist |

Three findings **[inference]**:

1. **Discovery is the hard part, not relaying.** Every system centralizes discovery or leans
   on gossip. Cradle already has a natural central directory — the fabric store.
2. **Nobody has solved incentive/reciprocity accounting.** Within one Cradle fabric, however,
   nodes belong to one owner — relaying is mutual aid; the incentive problem largely dissolves.
3. **Minimum viable abuse control**: signed expiring reservations + per-connection byte/duration
   caps + relay-side ACLs, with E2E encryption as table stakes. Cradle's certificate/grant
   machinery is already richer than anything above.

---

## 5. Transport substrate options (2025), given Cradle's platforms

Cradle's platforms: Go (relayd, server), Electron desktop, browser frontend, iOS.

### 5.1 QUIC (quic-go)

- Production-proven in Go; RFC 9221 datagrams implemented but flagged "currently not optimized";
  connection migration works. **[fact]**
- **Electron/Node: no usable QUIC** — `node:quic` experimental. Electron does have raw UDP
  via `node:dgram`. **[fact]**
- **Browsers: no raw QUIC/UDP** — WebTransport is the sanctioned path. **[fact]**
- **iOS**: raw UDP available; quic-go via gomobile production-proven (Tailscale iOS). **[fact/inference]**

### 5.2 WebTransport

- Chrome/Edge 97+, Firefox 114+; **Safari did not ship through 2025** — fallback needed.
  Go server side mature (webtransport-go). WebTransport-over-HTTP/2 still a draft. **[fact]**

### 5.3 Raw UDP + KCP/ARQ

- kcp-go production-grade with FEC, but single reliable ordered stream only — no unreliable
  datagrams, no migration, weak crypto. Wrong shape if unreliable delivery is a core need.
  Easiest UDP option for Electron (dgram) but that's all. **[fact + inference]**

### 5.4 WebRTC DataChannel (pion/webrtc)

- pion v4 mature; richest reliability menu; **only unreliable-datagram option working in every
  browser incl. Safari today**. Cost: ICE/STUN/TURN, SDP, DTLS, SCTP — redundant machinery if
  building own NAT traversal. iOS/Electron native libs mature. **[fact + inference]**

### 5.5 The WebSocket/TCP baseline

- Universal; what Cradle uses today. HoL blocking inherent. **Remains the mandatory fallback
  for UDP-blocked networks** — mirrors Tailscale's DERP-over-HTTPS design. **[inference]**

### 5.6 Per-platform feasibility

| Substrate | Go relay/server | Electron desktop | Browser | iOS |
|---|---|---|---|---|
| QUIC (quic-go) | ✅ mature | ⚠️ embedded helper/FFI | ❌ impossible | ✅ gomobile |
| WebTransport | ✅ mature | ⚠️ immature client | ✅ Chrome/FF; ❌ Safari | n/a |
| kcp-go | ✅ mature | ✅ easiest (dgram) | ❌ no UDP | ✅ raw UDP |
| WebRTC DataChannel | ✅ mature, heavy | ✅ Chromium native | ✅ universal | ✅ mature, heavy |
| WebSocket/TCP | ✅ | ✅ | ✅ | ✅ baseline |

**[inference] Bottom line**: for controlled endpoints (Go, Electron, iOS) QUIC is the coherent
substrate; Electron is the weak link; browsers need WebSocket fallback regardless. Pragmatic
path: keep WebSocket as the guaranteed floor, add UDP/QUIC direct paths as optimization,
scope to node-to-node (Go-to-Go) first.

---

## 6. Summary table: technique → benefit → cost → maturity

| Technique | What it buys | Cost / complexity | Maturity in Go / TS |
|---|---|---|---|
| STUN endpoint discovery + classification | Know NAT type, correct candidates | Moderate | ✅ Go mature; TS trivial client |
| Endpoint-independent punching | Direct UDP for majority of pairs | Low | ✅ Go; Electron via dgram |
| Birthday-paradox port guessing | Direct UDP hard×hard | Moderate, uncertain payoff | ⚠️ **Removed from current Tailscale — don't implement** |
| Fixed-port advertisement | Cheap extra hard-NAT candidate | Trivial | ✅ everywhere UDP exists |
| UPnP / NAT-PMP / PCP | Stable endpoint on cooperative routers | Moderate | ✅ Go reference; ⚠️ TS partial |
| IPv6 advertisement | Bypass NAT entirely | Trivial | ✅ everywhere |
| DERP-style central relay | Connectivity floor, TCP/443-compatible | Already built | ✅ `apps/relayd` exists |
| Home-relay hysteresis (10ms + ⅔ + liveness) | Stable relay assignment | Low, copyable constants | ✅ portable design |
| Disco-style encrypted signaling | Path negotiation untrusted relays can't read | Low-moderate | ✅ Cradle already has X25519 keys |
| libp2p reservations + caps | Safe delegation of relay capacity | Moderate | ✅ design portable; certs cover authz |
| AutoRelay self-selection + central directory | Automatic best-relay discovery | Moderate | ✅ pieces exist in Go |
| QUIC data plane | Encrypted, migrating, datagram-capable | High (Electron gap) | ✅ Go/iOS; ⚠️ Electron; ❌ browser |
| WebRTC DataChannel everywhere | One substrate all platforms | High complexity | ✅ everywhere but heavy |
| WebSocket fallback (status quo) | Universality | Already paid | ✅ implemented |

---

## 7. Design implications for Cradle **[inference — synthesis]**

1. **Keep relayd as the coordination point, not just a pipe** — directory + measurement oracle.
   Nodes with good connectivity volunteer as relay candidates in the directory; peers probe
   and pick with DERP-style hysteresis.
2. **The incentive problem is mostly absent inside one fabric** — mutual aid among one owner's
   devices. Cross-fabric relaying should not exist (enforced by existing cert/grant ACLs).
   What remains worth borrowing: per-connection byte/duration caps.
3. **The data plane can stay dumb** — Fabric Session is already E2E and transport-independent.
   What P2P adds is a disco-like path-negotiation channel, which can initially ride inside
   the existing fabric envelope space.
4. **Don't implement birthday-paradox punching** — current Tailscale removed it in favor of
   **UDP-relay servers run by ordinary nodes** (`net/udprelay`, disco 0x04–0x09:
   `AllocateUDPRelayEndpoint*` / `BindUDPRelayEndpoint*` / `CallMeMaybeVia`). **The user's idea
   is the direction Tailscale itself has already taken** — `net/udprelay` is the single most
   important reference implementation to study.
5. **Transport pragmatism** — WebSocket stays the floor; UDP/QUIC probing is an upgrade path,
   exactly as Tailscale treats DERP as floor and UDP as optimization. Scope P2P to Go-to-Go
   first; defer the Electron-QUIC problem.
