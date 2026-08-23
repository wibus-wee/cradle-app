# Plan 076: Replace point-to-point remote hosts with the Cradle Fabric

> **Executor instructions**: Read this plan completely before changing code. Run the drift check first. This plan intentionally breaks the existing Remote Host and relay-room product model; do not add a compatibility UI, an adapter that keeps the old API alive, or a second remote protocol. Temporary implementation scaffolding may exist inside a branch only while the new path is being proven, and must be removed before the branch is merged.

> **Drift check (run first)**:
>
>     git diff --stat 9cb62360..HEAD -- apps/relayd apps/server/src/modules/relay-transport apps/server/src/modules/remote-hosts apps/server/src/modules/session packages/db/src/schema/remote-host.ts packages/db/src/schema/remote-session-link.ts packages/db/src/schema/relay-host-enrollment.ts apps/web/src/features/settings/remote-hosts apps/web/src/features/workspace
>
> If any named ownership boundary has materially changed, compare this plan with the live implementation. Update this document's Context, Decision Log, interface signatures, and test commands before editing implementation code.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH — this replaces connection identity and may otherwise let an unauthorized controller reach a host, misroute an execution, or strand existing remote projections.
- **Depends on**: Plans 032, 033, and 034, which are complete. Their transparent upstream gateway and session projection behavior are reused under new names.
- **Category**: architecture and product replacement
- **Planned at**: commit `9cb62360`, 2026-08-16

## Purpose / Big Picture

After this change, a person installs Cradle on several computers, connects each computer to one Cradle Relay, and opens any one Cradle App to see every computer they are allowed to control. They select a Node, select one of that Node's workspaces, and create or continue a Work without entering an IP address, SSH profile, relay URL per host, pairing string, or an import-only remote workspace flow. The target Node remains the only machine that reads its files, starts its agent, holds provider credentials, and approves local effects. The controlling App only displays and controls that work.

The current product has a secure encrypted relay tunnel, but its public abstraction is a manually created `remote_host`. A relay room permits exactly one host socket and one controller socket. Its identity is a short-lived pairing code plus two public keys; relayd keeps rooms and pairing records only in memory. This is correct for a manually paired point-to-point tunnel, but it cannot answer “which of my machines are online?” and cannot safely allow a second authorized Cradle App to control the same machine.

This plan replaces that model with the **Cradle Fabric**. A Fabric is a local-first ownership domain identified by an owner signing public key. A **Node** is one enrolled Cradle Server. A **Controller** is a Cradle App allowed to view or control Nodes. The one relay deployment contains a small durable directory and a presence service as well as the existing opaque encrypted forwarding service. It discovers only Nodes within the caller's Fabric; it never exposes a global machine list.

The user-visible acceptance demonstration is: start relayd, enroll two isolated Cradle Servers into one Fabric, open a third Cradle App as the controller, observe both Nodes in one Nodes surface, create a session on either Node, send a streamed response and a tool approval through the selected Node, disconnect and reconnect the Node, and observe the same session recover through its normal event cursor. Repeat with a controller that has `view` scope and observe that it can see the Node but receives an authorization error before any tunnel or agent command is opened.

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while executing it.

## Progress

- [x] (2026-08-16 11:50Z) Read the live relay tunnel, remote-host gateway, remote session projection, and Codex Remote transport designs; recorded the replacement boundary and target topology.
- [x] (2026-08-16 12:05Z) Chose a Fabric owner signing key rather than introducing a Cradle SaaS account or reusing provider credentials.
- [x] (2026-08-16) Add relayd's durable Fabric directory, membership certificates, node presence, and authenticated directory API. Implemented SQLite store, signed Node and Controller join requests, owner-approved certificates, grants, snapshot-first directory routes, and revocation regression coverage; `go test ./...` passes in `apps/relayd`.
- [x] (2026-08-17) Replace one-room/one-controller relay transport with one long-lived Node connection and many independently encrypted controller links. (implemented: relayd v3 link lifecycle, short-lived link expiry, Node-side controller-certificate delivery, TypeScript v3 envelope adapter, demand-driven controller link, and Node socket demultiplexer; legacy room hub/pairing/token removed from relayd and `go test ./...` passes; remaining: real two-process transport acceptance test.)
- [x] (2026-08-17) Replace local `remote_hosts` and relay enrollments with one local Fabric membership and a Node directory cache. (implemented: local membership/secret references, create/join/approve directory client, Node list endpoint, handwritten migration `0060` dropping the four legacy tables, and a one-time `legacy-remote-network-v1.json` export cleanup in the migration runner with `tests/fabric-legacy-cleanup.test.ts`.)
- [x] (2026-08-17) Route workspace, session, chat, terminal, and provider requests through `nodeId`; retain target-Node authority and local session projection semantics. (implemented: renamed `remote-projection.ts` to `node-projection.ts`, switched the projection table and session execution contract to `node_session_links` / `execution.kind: 'node'`, routed linked session HTTP through the demand-driven Fabric link, implemented the Fabric WebSocket upstream bridge replacing the 1013 stub, and migrated `workspaceLocator` to `{ nodeId, path, sourceWorkspaceId?, kind? }` across workspace/git/terminal/chat-runtime.)
- [ ] Replace Remote Hosts settings and workspace import surfaces with the Nodes product surface and automatic node enrollment flow. (implemented: `apps/web/src/features/nodes/` Nodes sidebar section with this-device/online/offline grouping, Fabric create/join/approve dialogs with one-time invitation display, owner-only Node Access surface backed by grant listing/revocation routes, Node workspace picker merged by Git identity in the add-workspace dialog, session `On <Node>` badge, view-only composer/approval gating, and locale keys in all locales; remaining: real two-Node desktop smoke.) (legacy Remote Hosts/relay settings UI, import-only remote workspace flow, and dead locale keys deleted; Nodes surface in flight.)
- [x] (2026-08-17) Delete all legacy remote-host, per-room pairing, SSH, direct URL, and relay-server-registry runtime paths; execute one-time legacy cleanup/export. (relayd: pairing/token/room hub removed, httpapi mounts directory + FabricHub only; server: `remote-hosts/`, `relay-servers/`, host-connector/host-enrollment/relay-auth-token removed, app.ts rewired, CLI regenerated; rg sweep clean outside migration/export tests.)
- [x] (2026-08-17) Run focused transport, server, and web acceptance checks. (`go test ./...` in `apps/relayd`; Fabric grant and WebSocket bridge tests; 25 affected server tests across Fabric cleanup, Node projection, workspace, session, and relay transport; 19 Nodes/workspace web tests; server and web typechecks; server module-boundary check; and `git diff --check` all pass.)
- [ ] Run the real two-Node end-to-end acceptance test and manual desktop smoke; update this plan and `plans/README.md` with the outcome.

## Surprises & Discoveries

- Observation: the existing tunnel already carries arbitrary HTTP, SSE, and WebSocket traffic, so Fabric does not need to invent an agent-specific wire protocol.
  Evidence: `apps/server/src/modules/remote-hosts/upstream.ts` forwards HTTP/SSE and `upstream-websocket.ts` bridges upgraded WebSockets through a controller-local tunnel.

- Observation: the existing relay is deliberately unable to discover Nodes. It stores `rooms` and pairing records in process memory, and `relay.Hub.register` rejects a second socket for either role.
  Evidence: `apps/relayd/internal/relay/hub.go` has one `host` and one `controller` field per room and returns `ErrRoomFull`; `apps/relayd/internal/pairing/store.go` is an in-memory map keyed by room id.

- Observation: the existing one-time pairing binds a single controller signing key to a host enrollment. It cannot express a second controller, a revocation list, or a view-only permission.
  Evidence: `apps/server/src/modules/relay-transport/README.md` documents one stored controller signing public key; `apps/relayd/internal/token/token.go` has only host/controller roles and no Fabric or grant scope.

- Observation: Remote session projection is the right execution boundary and should survive, but its identifier must become `nodeId`, not `hostId`.
  Evidence: `apps/server/src/modules/session/remote-projection.ts` makes the remote session authoritative and blocks local runtime execution; Plan 033 already guarantees linked sessions do not enter the local TurnExecutor.

- Observation: a relay cannot safely turn a one-time enrollment string into an owner-signed membership certificate because it never possesses the Fabric owner private key.
  Evidence: the existing pairing model only binds public keys at relayd. The Fabric implementation therefore uses a Node-signed join request with a locally retained delivery secret, followed by an owner Controller signing the exact Node identity before relayd persists it.

- Observation: the old inner relay session can preserve its encryption, stream multiplexing, and credit accounting if its outer-envelope encoder is injected instead of duplicating the state machine.
  Evidence: `apps/server/src/modules/relay-transport/session.ts` now accepts `encodeOutboundEnvelope`; Fabric v3 encodes only its outer route in `modules/fabric/fabric-envelope.ts`.

## Decision Log

- Decision: make one Fabric owner Ed25519 public key the root of discovery and authorization; do not add a mandatory cloud account in this plan.
  Rationale: Cradle is local-first and currently has no product-level user identity service. Reusing GitHub, OpenAI, or provider credentials would couple machine authorization to an unrelated integration and would make self-hosting impossible. A Fabric key is generated in Cradle's managed secret store, its public half is registered at relayd, and it signs membership certificates. The owner private key never leaves a controller Node.
  Date/Author: 2026-08-16 / Codex

- Decision: one public relay deployment is both a directory/presence control plane and an encrypted data plane, but these remain separate packages and trust boundaries inside relayd.
  Rationale: the desired deployment is one small relay server, not a new cloud fleet. Directory metadata must be durable and inspectable; tunnel payloads must remain opaque. Combining their deployment does not justify combining their data models or granting the directory access to prompt, code, credential, or tool payload bytes.
  Date/Author: 2026-08-16 / Codex

- Decision: replace the permanent pair room with a persistent Node connection plus ephemeral `linkId` connections from authorized Controllers.
  Rationale: a Node should not reconnect once per controller and no permanent room should encode one Controller. A host WebSocket is keyed by `nodeId`; each Controller opens a short-lived link to that Node. Each link has its own X25519 handshake, encryption keys, stream ids, ACK cursors, flow-control budget, and cancellation. This keeps the existing relay session mechanics useful while allowing several controllers without their messages or recovery cursors colliding.
  Date/Author: 2026-08-16 / Codex

- Decision: make `view`, `control`, `approve`, and `admin` explicit grants. `control` does not imply approval.
  Rationale: the important mobile/remote-control action is often answering an approval prompt. It must be separately grantable and auditable. The target Node checks the owner-signed certificate before exposing or accepting a link, so a compromised relay cannot elevate `view` to `control`.
  Date/Author: 2026-08-16 / Codex

- Decision: delete `remote_hosts`, `relay_host_enrollments`, `relay_servers`, all direct URL/SSH transport configuration, and the Remote Hosts settings surface after Fabric is usable.
  Rationale: these names expose transport and cryptographic plumbing as user concepts. Keeping them would retain two discovery sources, two connection lifecycles, and two support paths. Direct LAN/SSH reachability may return later as a Node-link optimization, but it must satisfy the Fabric interfaces and never become a second user-facing topology.
  Date/Author: 2026-08-16 / Codex

- Decision: preserve only a local JSON export of legacy remote metadata, then delete remote local projections rather than attempting automatic host-id-to-node-id migration.
  Rationale: old rows have no Fabric identity and may point to a different relay or a dead machine. Guessing an identity would be unsafe. The source session remains on the remote host; local projections are disposable handles. Local-only sessions and workspaces remain untouched. This is a one-time destructive migration, not an ongoing compatibility shim.
  Date/Author: 2026-08-16 / Codex

- Decision: the joining Node, rather than relayd, creates the raw QR delivery secret; relayd stores only its SHA-256 hash.
  Rationale: this makes `POST /v1/join-requests` safely retryable after a lost response, avoids relay-side secret recovery, and ensures the owner certificate is still bound to a self-signed Node identity. The owner sees the raw secret only in the short-lived QR payload it deliberately scans.
  Date/Author: 2026-08-16 / Codex

- Decision: retain the old room endpoints only inside the unmerged implementation series until the Fabric Node/link transport and Cradle Server client are usable; remove them atomically in Milestone 5.
  Rationale: deleting the only active transport before its replacement exists would create a branch that cannot dogfood either path. This is temporary implementation sequencing, not a compatibility product surface: no new code may consume the legacy endpoints, and the final merged shape contains only Fabric endpoints.
  Date/Author: 2026-08-16 / Codex

- Decision: give a Controller the Node's owner-signed certificate in the authenticated link response, and give the Node the Controller certificate in a `link_open` control envelope.
  Rationale: this lets both endpoints pin the peer's X25519 key to the owner trust root. The relay decides capacity and routing but cannot substitute either encryption key without causing certificate verification to fail.
  Date/Author: 2026-08-16 / Codex

## Context and Orientation

The repository currently has three relevant layers.

`apps/relayd` is a Go relay process. `apps/relayd/internal/httpapi/server.go` exposes `/pairing/start`, `/pairing/claim`, `/rooms/host-session`, `/ws/host`, and `/ws/controller`. It validates self-signed short-lived assertions. `apps/relayd/internal/relay/hub.go` forwards opaque envelopes between one host and one controller in a room. `apps/relayd/internal/pairing/store.go` keeps pairing codes in memory. This process cannot restart without losing its current room directory, and it owns no concept of a user, Fabric, Node, permission grant, or presence list.

`apps/server/src/modules/relay-transport` is the current TypeScript tunnel implementation. Host enrollment creates X25519 encryption and Ed25519 assertion keys. `host-connector.ts` keeps one host-side relay connection alive and bridges streams to the local Cradle Server HTTP port. `session.ts` owns end-to-end encryption, stream multiplexing, cumulative acknowledgements, and bounded flow control. The relay sees outer routing data but not inner HTTP bytes. This module is a data plane and must remain the owner of encryption and byte transport.

`apps/server/src/modules/remote-hosts` is the current controller-local registry. Its `remote_hosts` row contains a display name and a transport-specific JSON configuration. The transparent upstream gateway maps `/remote-hosts/:hostId/upstream/*` to a locally opened tunnel. Plan 033 added `remote_session_links`: a local session is only a projection and maps to `{ hostId, remoteSessionId, remoteWorkspaceId }`; all chat routes are forwarded to the target server. The target server owns the actual runtime.

The replacement terms are exact:

- A **Fabric** is an ownership domain. It has a random `fabricId`, one owner Ed25519 public key, one relay base URL, and no provider credentials.
- A **Node** is an enrolled Cradle Server. It has a stable `nodeId`, a node Ed25519 identity key for relay authentication, an X25519 key for link encryption, a human label, a capability summary, and an online/offline presence. A Node may be a desktop, a headless devbox, or the controller's own machine.
- A **Controller** is another enrolled Cradle App/Server with an Ed25519 identity key and X25519 encryption key. It may receive scoped grants for Nodes.
- A **membership certificate** is canonical JSON signed by the Fabric owner key. It binds a subject type, subject identity public key, subject encryption public key, Fabric id, optional Node id restriction, scopes, issued time, expiry, and nonce. Relayd verifies it to create durable records; the target Node verifies it again before accepting an encrypted link. Certificates are never provider tokens.
- A **link** is a transient, authenticated encrypted connection from one Controller to one online Node. It is identified by `linkId`. It is not persisted as a user-visible object. A link contains many byte streams; the existing relay tunnel's stream flow-control rules apply per link.
- A **projection** remains a local sidebar/API handle. A `node_session_link` maps a local session id to `{ nodeId, remoteSessionId, remoteWorkspaceId }`. It does not duplicate agent ownership or event history.

The following invariants are non-negotiable:

1. The relay directory lists Nodes only after authenticating a Controller and filtering its grants. There is no unauthenticated “all Nodes” endpoint.
2. Node presence and a capability summary may be visible to authorized Controllers. Paths, Git remotes, workspace file names, prompts, provider credentials, tool payloads, terminal bytes, and chat content are not directory metadata.
3. The target Node is always the authority for workspace/session/provider/runtime/approval semantics. The controller does not execute remote paths locally.
4. A command is addressed to exactly one `nodeId` and one remote session. Its idempotency, event cursor, and approval identity remain the target Node's existing contracts.
5. Every cross-network data byte travels inside the existing authenticated end-to-end encrypted relay session. Relayd may route by Fabric, Node, link, and stream identifiers only.
6. Any Node or Controller grant revocation immediately prevents new links and closes current matching links. Revocation is not eventually applied at the next app restart.

## Target Interfaces and Dependencies

Use Go's standard `database/sql` with the pure-Go `modernc.org/sqlite` driver for relayd's one-server durable metadata store. Configure WAL mode, foreign keys, and a bounded busy timeout at open. Do not introduce Postgres, Redis, a managed database, or a second service in this plan. Relayd remains horizontally non-scaled by design; its documented limit is one deployment serving one or a small number of Fabrics. A future scale-out plan can replace the `DirectoryStore` implementation without changing relay protocol semantics.

Add the following Go package boundaries under `apps/relayd/internal`:

- `fabric/` owns the SQLite schema and transactional queries for Fabrics, identities, Node records, grants, signed join requests, revocations, and last-seen timestamps. It does not import `relay` or inspect encrypted payloads.
- `directory/` owns authenticated HTTP and WebSocket directory endpoints, request/response shapes, presence publication, and conversion from a valid membership certificate into Fabric records. It calls `fabric.Store` and `relay.Hub`; it does not implement cryptography itself.
- `relay/` owns the Node/link connection hub, queue bounds, outer envelope parsing, and relay-side link lifecycle. It receives only already-authorized identifiers and certificates from `directory`.
- `token/` is replaced by `membership/`. It owns canonical certificate signing and verification, short-lived connection challenge signing, nonce replay protection, and stable error categories. Delete the old room assertion types rather than extending them with optional Fabric fields.

Relayd must expose these versioned endpoints:

    POST /v1/fabrics
    POST /v1/join-requests
    GET  /v1/join-requests/{requestId}
    POST /v1/join-requests/{requestId}/approve
    POST /v1/fabrics/{fabricId}/controllers
    GET  /v1/fabrics/{fabricId}/nodes
    GET  /v1/fabrics/{fabricId}/events
    POST /v1/nodes/{nodeId}/links
    DELETE /v1/nodes/{nodeId}/grants/{grantId}
    GET  /v1/ws/nodes
    GET  /v1/ws/controllers/{linkId}

`POST /v1/fabrics` accepts an owner public key and a self-signed creation request, creates a random Fabric id, and returns no secret. An unenrolled device creates a self-signed `POST /v1/join-requests` request containing its subject kind, identity/encryption public keys, and a hash of a locally generated delivery secret. A Node approval returns a Node certificate plus its companion Controller certificate. A Controller-only approval returns one Node-restricted Controller certificate plus explicit grants. Relayd verifies and persists the owner decision but never signs membership on the owner's behalf. The joining device polls `GET /v1/join-requests/{requestId}` with its secret and receives the same approved certificate set idempotently after a lost response. A Controller opens a link only with a valid unrevoked `control` or `admin` grant. `GET /nodes` returns a compact `NodeSummary` filtered to grants; the events endpoint publishes `node.upsert`, `node.presence`, and `node.removed` revisions without workspace contents.

Define the public protocol types in a language-neutral `apps/relayd/protocol/fabric-v1.json` file and generate/check TypeScript types into `apps/server/src/modules/fabric/protocol.generated.ts`. Do not hand-maintain duplicated TypeScript and Go structural types. The schema must include these shapes:

    NodeSummary {
      nodeId, fabricId, displayName, platform, version,
      capabilities, status: 'online' | 'offline', lastSeenAt, revision
    }

    MembershipCertificate {
      version, fabricId, subjectKind: 'node' | 'controller', subjectId,
      identityPubkey, encryptionPubkey, nodeId?, scopes,
      issuedAt, expiresAt?, nonce, issuerPubkey, signature
    }

    OpenLinkRequest { nodeId, controllerCertificate, controllerConnectionProof }
    OpenLinkResponse { linkId, expiresAt }

    FabricEnvelope {
      version: 3, fabricId, nodeId, linkId, streamId?, seq, ack?,
      kind: 'link_open' | 'link_ready' | 'relay_data_frame' |
            'relay_peer_closed' | 'relay_error',
      priority: 'control' | 'data', payload
    }

The outer envelope does not contain an HTTP URL, session id, command, file path, or content. The first encrypted inner frame carries the controller certificate and validates that the Controller X25519 key matches the certificate. The Node rejects mismatched, expired, revoked, or scope-insufficient certificates before creating a `RelaySession`.

In the TypeScript app, create one `apps/server/src/modules/fabric/` owner. It owns the local Fabric identity secret refs, registration with the configured relay, node directory cache, directory event subscription, opening/closing `NodeLink`s, and translating a Node link into the same narrow local tunnel handle already consumed by the upstream gateway. It must not own sessions, workspaces, chat runtime, or provider catalog semantics. The transport-private code moves from `relay-transport` into `fabric/transport/` without changing its flow-control and encryption ownership.

Expose only these server-facing routes:

    GET    /fabric
    POST   /fabric/create
    POST   /fabric/join
    GET    /nodes
    GET    /nodes/:nodeId
    POST   /nodes/:nodeId/connect
    DELETE /nodes/:nodeId/grants/:grantId
    ALL    /nodes/:nodeId/upstream/*

`POST /nodes/:nodeId/connect` is normally internal and idempotent: it opens or reuses a link. It never asks the user for a host address. The web application calls only local Cradle APIs. `ALL /nodes/:nodeId/upstream/*` preserves the existing HTTP/SSE/WebSocket proxy behavior, except the link is resolved by Node id. The implementation may keep the old upstream bridge code but must move it into the Fabric namespace and delete the old route.

Replace these database/API identifiers everywhere they denote the old Remote Host product. Do not rename unrelated internal resource identifiers such as `provider-runtime`'s lease `hostId` merely because they share a word:

    remote_hosts                 -> no replacement local registry
    relay_host_enrollments       -> fabric_membership
    relay_servers                -> fabric.relayUrl configuration
    remote_session_links         -> node_session_links
    hostId                       -> nodeId
    execution.kind: remote-host  -> execution.kind: node
    /remote-hosts/*              -> /nodes/*

`fabric_membership` is a one-row local table containing `{ fabricId, relayUrl, localNodeId, role, ownerKeyRef?, identityKeyRef, encryptionKeyRef, certificateJson, createdAt, updatedAt }`. `node_session_links` uses `{ localSessionId, nodeId, remoteSessionId, remoteWorkspaceId, createdAt, updatedAt }` and retains the existing unique Node/remote session constraint. `workspaceLocator` changes from `{ hostId, path, ... }` to `{ nodeId, path, sourceWorkspaceId?, kind? }`. No old field is optional.

## Plan of Work

### Milestone 1: Establish durable Fabric identity and directory behavior in relayd

First make relayd able to own the small amount of metadata required for discovery. This milestone does not tunnel a Cradle request yet. It proves that a Fabric owner can create a Fabric, enroll two Nodes, grant a Controller view/control scopes, list only permitted Nodes, receive online/offline events, and revoke a grant. It also proves a relay restart retains ownership records but correctly marks disconnected Nodes offline until they reconnect.

Create `apps/relayd/internal/fabric/store.go`, `migrations.go`, and focused tests. The initial SQLite tables are `fabrics`, `principals`, `nodes`, `node_grants`, `join_requests`, and `revocations`. `nodes` stores only summary metadata and public keys. `join_requests` stores an expiry, subject public keys, an owner-approved certificate, and a one-time delivery marker; it never stores an owner secret. `node_grants` has a unique `(fabric_id, controller_id, node_id, scope)` tuple and a `revoked_at` field; revocation must leave an auditable row. The Store owns transactions that prove a controller belongs to the Fabric before listing or opening links.

Add `apps/relayd/internal/membership` alongside the temporary old room assertion types. Add deterministic canonical JSON tests for certificate signatures, expiry, wrong Fabric, scope restriction, nonce reuse, and key mismatch. Add `apps/relayd/internal/directory/server.go` and register its `/v1` routes from `internal/httpapi/server.go`. Keep health/metrics routes. The old pairing endpoints remain only until the Fabric Node/link transport and Cradle Server client pass their two-host acceptance test; delete them with the old transport in Milestone 5.

Use the Hub's live node map as presence authority. On an authenticated Node WebSocket open, mark it online and publish an increasing per-Fabric revision; on close, mark it offline and publish another revision. Persist only `last_seen_at`. Directory event subscribers reconnect with `afterRevision`; if the requested revision is too old, return a full `NodeSummary[]` snapshot followed by live events. This behavior is deliberately snapshot-plus-cursor, not CRDT replication.

Acceptance: Go integration tests start relayd with a temporary SQLite path, create Fabric A and Fabric B, enroll Nodes into both, and assert that Controller A neither lists nor opens a link to Fabric B. Restart relayd using the same SQLite file; assert Node metadata persists, presence becomes offline, and a reconnected host produces exactly one `node.presence` online event.

### Milestone 2: Replace the room hub with Node/link multiplexing and retain encrypted byte transport

Refactor `apps/relayd/internal/relay/hub.go` so its top-level live object is a connected `nodeId`, not a room. A Node socket may have many link states. A controller WebSocket has one `linkId` and one target `nodeId`. Link creation is initiated only by the directory after it has checked Fabric membership and scope; the Hub cannot synthesize an authorization decision from a caller-provided public key.

Replace the old outer `Envelope` with Fabric protocol v3. Preserve the existing queue protections: maximum frame bytes, separate control capacity, per-stream round-robin data scheduling, heartbeat, idle timeout, and flow-control backpressure. Make all sequence and acknowledgement state `(linkId, streamId)` scoped. A slow controller must never occupy data queue capacity for another controller. Closing or revoking one link must not close the Node socket or other Controller links.

Refactor `apps/server/src/modules/relay-transport/session.ts`, `host-connector.ts`, and `controller-transport.ts` into `apps/server/src/modules/fabric/transport/`. A `FabricNodeConnector` owns one outbound authenticated Node WebSocket and `Map<linkId, RelaySession>`. A `FabricControllerLink` owns one Controller WebSocket and one `RelaySession`. Reuse the existing X25519 key agreement, HKDF derivation, 64 KiB chunks, and bounded credits. Fabric Session v2 negotiates AES-256-GCM or XChaCha20-Poly1305 and `none` or Zstandard compression; AES-256-GCM with no compression is the portable native-client baseline. Do not replace a working encrypted transport with HTTP polling or a fresh TCP protocol.

Before accepting an encrypted `hello`, the Node validates an owner-signed controller membership certificate delivered in the link-open control data. It checks Fabric id, Node restriction, scope, controller encryption key, expiration, and locally cached revocation revision. The relay also checks grants. Both checks are required: relay authorization protects capacity, while Node verification preserves end-to-end authority if relayd is compromised.

Acceptance: a real relayd subprocess test opens one Node and two Controllers. Both perform independent encrypted handshakes and transfer concurrent HTTP streams. Revoke Controller One while it has a stream: its stream and link close with `fabric_grant_revoked`; Controller Two continues its transfer; the Node remains online. Reconnect the Node and prove Controller Two can reopen a link with a new link id, while a replayed old link envelope is rejected.

### Milestone 3: Make Fabric the only Cradle Server control-plane model

Create `apps/server/src/modules/fabric/{index.ts,model.ts,service.ts,directory-client.ts,node-link-manager.ts,upstream.ts,upstream-websocket.ts,README.md}`. `service.ts` owns one local Fabric membership. It creates a Fabric on first use or joins one through an owner-approved signed join request. A Node enrollment generated on a headless host prints a QR-compatible join string; a desktop controller scans it and signs the exact Node identity from the Nodes page. A Node that is already enrolled reconnects automatically at boot, publishes capabilities and a display name, and requires no pairing screen.

The local directory cache is strictly a cache of the relay directory. It has a Fabric revision and Node summaries only; deleting cache rows does not revoke or delete remote Nodes. `node-link-manager.ts` single-flights links by node id, tears links down on directory revocation/presence changes, applies bounded jitter reconnect only for the Node's own host connection, and exposes an existing `LocalTunnelHandle` shape to `upstream.ts`. Controller links are demand-driven and close after the existing idle policy; they are never pre-opened for every directory entry.

Move `remote-hosts/upstream.ts` and `upstream-websocket.ts` into Fabric, changing only owner imports and route path. Ensure bodyless read retry remains at most once after a replaceable link failure; mutations and streams are never replayed. Browser code continues to target the local server base URL.

Replace `remote_session_links` with `node_session_links`, then update `apps/server/src/modules/session/remote-projection.ts`, session models, session service, and global linked-chat proxy to use `nodeId`. Rename the module and documentation to `node-projection.ts` if doing so makes ownership clear. The rules do not change: remote session is the source of truth; local linked sessions never execute in the local runtime; deletion calls the target Node first and does not remove the local projection after a remote failure.

Update workspace locator types and all consumers in `apps/server/src/modules/workspace`, `git`, `terminal`, `chat-runtime`, and generated OpenAPI APIs. A remote-mounted workspace becomes a Node workspace. It exposes a display-only `nodeId` and Node label in responses; it never carries transport configuration. Every capability is reached through `/nodes/:nodeId/upstream/*` after an authorized link is open.

Acceptance: server tests create a Node directory fixture and a fake target Node behind a real Fabric link. They create a Node-mounted workspace, create a local projection session, send chat through the local session id, receive SSE and WebSocket traffic, and assert the target server—not the controller's local runtime—observed the command. When node presence switches offline, create/send returns `fabric_node_offline` with a Connect/retry action; when the Node returns, the same session works without a new local projection.

### Milestone 4: Replace the product surface with Nodes and hide plumbing

Delete `apps/web/src/features/settings/remote-hosts/**`, remote host settings APIs, and all UI labels such as “connect remote host,” “claim relay,” “SSH,” and “direct URL.” Create `apps/web/src/features/nodes/` with a fixture-driven `NodesView`, a Container that reads local `/nodes`, and a node picker reusable by new-work/new-chat workspace selection. Add a compact Nodes section in the existing navigation rather than a card dashboard.

The Node list has `This device` first, then online Nodes, then offline Nodes. Each row shows name, operating system, capabilities, online state, and the number of currently known Workspaces only after it has been fetched on demand. Selecting a Node fetches workspace summaries over its link; selecting a workspace follows existing session creation routes. The chat header/session list says `On <Node name>` based on `execution.kind === 'node'`. It does not mention relay transport.

The first-run flow has only two user actions: “Create Cradle Network” when no local Fabric exists, or “Join Cradle Network” when scanning/pasting a headless Node invitation. On a desktop that has joined a Fabric, the local machine enrolls itself automatically. The raw invite is shown once and is not list-readable, matching the security posture of existing one-time secrets. Node grant management is behind a small “Access” detail surface with the explicit four scopes; no silent shared control exists.

Follow the repository rendering seam: `*View` receives typed fixture data/callbacks and no query, Electron, generated client, or global store. Add stories for empty Fabric, two online Nodes, offline Node, view-only Node, denied connection, enrollment ready, and revocation. Add locale keys to every required locale. Do not build browser E2E unless the two-server test cannot exercise the behavior.

Acceptance: Storybook fixtures prove all Node states. A focused web test proves that selecting a Node workspace passes only `workspaceId`, that remote catalog resolution follows session `execution.kind === 'node'`, and that view-only Nodes cannot render enabled composer/approval controls. A manual desktop smoke demonstrates a single Cradle App starting a Work on another Node without ever opening settings for a transport.

### Milestone 5: Execute the deliberate break and remove obsolete concepts

After the Fabric path passes the two-Node acceptance test, remove these sources in the same merge series: `apps/server/src/modules/remote-hosts/**`, `apps/server/src/modules/relay-transport/**`, `apps/server/src/modules/relay-servers/**`, their generated CLI commands, direct URL/SSH schemas, and old relay room/pairing HTTP endpoints. Do not leave deprecated route aliases. Update `apps/server/src/app.ts`, desktop startup, OpenAPI generation, and package exports so there is exactly one network owner.

Add a pre-migration cleanup in `apps/server/src/database/migration-runner.ts` before Drizzle executes the Fabric migration. It detects legacy remote tables, writes an atomic JSON export named `legacy-remote-network-v1.json` next to the configured Cradle data directory with restrictive file permissions, then removes only local remote projections and remote-mounted workspace rows in a transaction. The export contains display labels and old opaque ids/configurations but never key references, relay auth tokens, or pairing strings. It does not call remote Nodes. It leaves ordinary local workspaces, sessions, messages, and Work unchanged. If export creation or transaction completion fails, server startup stops before schema migration and reports the path/error; it must never perform a partial cleanup.

The Fabric Drizzle migration then drops `remote_hosts`, `remote_session_links`, `relay_host_enrollments`, and `relay_servers`; creates `fabric_membership` and `node_session_links`; and removes old foreign-key consumers. The upgrade notes state clearly that previously paired remote Nodes must be enrolled into a Fabric again and that original sessions remain on their target Nodes. This is a breaking release. Do not attempt a background conversion or a legacy restore screen.

Acceptance: an upgrade fixture database with one local and one old remote workspace/session produces the JSON export, retains the local entities, removes the remote projection rows, and opens the new server without any old route/schema references. `rg` must find no production imports of the old Remote Host modules/routes/configurations (`remote-hosts`, `relay-transport`, `relay-servers`, `/remote-hosts`, `direct-url`, or `transport: 'ssh'`) outside migration/export tests and the release note. Domain-local `hostId` fields must have become `nodeId`; unrelated resource-manager symbols may remain.

## Concrete Steps

Work from the repository root. Keep the currently checked-out branch clean except for this plan's files. Do not stage unrelated edits.

1. Create the relayd data store and directory tests before changing the tunnel:

       cd apps/relayd
       go test ./internal/fabric ./internal/membership ./internal/directory ./internal/httpapi

   Expect Fabric A/B isolation, invitation single use/expiry, grant filtering, restart persistence, and presence cursor tests to pass.

2. Implement and prove Node/link multiplexing:

       cd apps/relayd
       go test ./internal/relay ./internal/httpapi
       cd ../..
       pnpm --filter @cradle/server exec vitest run tests/fabric-transport --reporter=dot

   Expect a real relayd subprocess test to show two controllers sharing one Node without cross-link bytes, and an immediate revocation close for only the revoked controller.

3. Generate and typecheck server/database contracts after introducing the Fabric module:

       pnpm --filter @cradle/db generate
       pnpm --filter @cradle/server typecheck
       pnpm --filter @cradle/web generate
       pnpm --filter @cradle/web typecheck

   Expect all generators to complete without hand-edited generated artifacts and both typechecks to exit 0.

4. Run the target authority and recovery suite:

       pnpm --filter @cradle/server exec vitest run tests/fabric-node-directory.test.ts tests/fabric-node-link.test.ts tests/fabric-node-projection.test.ts tests/remote-session-projection.test.ts --reporter=dot
       pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts --maxWorkers=1 --reporter=dot

   Replace the final legacy remote-session test with the renamed Node test before removal. Expect the local runtime guard and remote upstream path to be exercised in the same run.

5. Run UI/unit and mandatory upgrade checks:

       pnpm --filter @cradle/web test
       pnpm --filter @cradle/web typecheck
       pnpm --filter @cradle/server exec vitest run tests/fabric-legacy-cleanup.test.ts --reporter=dot
       git diff --check
       rg -n "remote_hosts|remote_session_links|relay_host_enrollments|relay_servers|/remote-hosts|transport: 'ssh'|direct-url" apps packages --glob '!**/drizzle/**' --glob '!**/fabric-legacy-cleanup.test.ts'

   Expect no search matches in production code. A result in a release note or the explicit cleanup fixture is acceptable only if it cannot be imported by production runtime.

6. Perform one manual two-host smoke before marking the plan complete:

       pnpm --filter @cradle/relayd build
       pnpm --filter @cradle/server dev -- --data-dir /tmp/cradle-fabric-controller

   Start two isolated server data directories and one relayd SQLite directory. Create or join one Fabric, confirm both Nodes appear in the controller UI, create a remote Node Work, approve a tool, kill the target Node's relay socket, observe offline state, restart it, and continue the same Work. Record only timing/status evidence in this plan; do not record credentials or prompt payloads.

## Validation and Acceptance

The change is complete only when all of the following are true.

- A relayd restart preserves Fabric/Node/grant records and loses only transient online state.
- A controller can discover only Nodes granted to its Fabric identity; a guessed `nodeId` from another Fabric returns `fabric_node_not_found` without revealing metadata.
- Two Controllers can independently open encrypted links to one Node; one controller's cancellation, congestion, reconnect, or revocation does not affect the other.
- The target Node rejects a relay-authorized but owner-certificate-invalid controller before accepting encrypted payloads.
- One Cradle App automatically lists itself and its granted remote Nodes after startup, without `remote_hosts` configuration or a relay pairing string.
- A selected Node workspace creates a local session projection and all actual execution occurs on the selected Node.
- Streaming, tool approvals, and WebSocket features traverse Node links through existing upstream forwarding semantics.
- Presence events converge after reconnect using revision/snapshot semantics; no CRDT or replicated chat history is introduced.
- View-only grants never open a control link; control without approve cannot answer a pending approval; revocation closes live links immediately.
- Legacy remote data export is atomic and local-only data survives the breaking migration.
- All focused Go/TypeScript tests, server and web typechecks, generated clients, and `git diff --check` pass.

## Idempotence and Recovery

Fabric creation is idempotent from the controller's perspective only after the server receives a stable `requestId`; retrying `POST /v1/fabrics` with the same owner public key/request id returns the same Fabric rather than creating another. Join-request approval is idempotent for the same request/certificate fingerprint. The Node may retry polling after a network timeout, but the certificate is delivered only to the authenticated subject public key; a completed request never issues a second Node id.

Node connection and `POST /nodes/:nodeId/connect` are idempotent. Link reuse is allowed only while it targets the same Node, certificate fingerprint, and Fabric directory revision. When a presence or grant revision invalidates one of those inputs, close the old link and create a new link; do not redirect bytes in place.

Relayd's SQLite migrations use transactions and preserve a dated file backup before upgrading schema. The local Cradle legacy cleanup writes the export file with an atomic temporary-file rename before it begins its database transaction. If it fails, do not run Drizzle migration; after correcting disk permissions or space, rerun startup. Restoration is deliberately manual: stop Cradle, restore the backup database, and remove the completed migration marker. Do not implement a runtime “legacy remote mode.”

For a failed deployment after old code deletion but before all clients update, roll back the application binary and restore its database backup. A Fabric-enabled server must not attempt to connect to an old room relay; an old client must fail closed against the new relay endpoints rather than downgrade authorization.

## Artifacts and Notes

The target topology is:

    Controller Cradle App
      -> authenticated directory query / link request
      -> one encrypted Controller link
      -> relayd routes opaque FabricEnvelope values
      -> persistent Node connection
      -> target Cradle Server HTTP/SSE/WebSocket listener

Directory metadata is intentionally bounded:

    allowed: node id, label, platform, version, capability flags,
             online state, last-seen time, revision
    forbidden: workspace paths/names, repository urls, file names, prompts,
               chat events, terminal output, provider identities/credentials,
               HTTP headers and bodies

The local target-routing rule is:

    localSessionId -> node_session_links -> nodeId + remoteSessionId
    /chat/sessions/localSessionId/* -> /nodes/nodeId/upstream/chat/sessions/remoteSessionId/*

No chat history is copied between databases. Existing event cursors and session snapshots remain an execution-local recovery mechanism. Fabric only restores network reachability.

Revision note (2026-08-16): initial plan created after reviewing the existing relayd room hub, relay transport, and completed remote-session projection work. It deliberately replaces rather than extends the Remote Host product model.

Revision note (2026-08-16): recorded the v3 Node/link transport seam, certificate hand-off, and local Fabric control-plane implementation so the remaining breaking removal work can resume from the plan alone.

## Outcomes & Retrospective

Automated two-Node acceptance was added on 2026-08-19 as
`CRADLE-FABRIC-001`. It starts one relayd and two Cradle Servers with independent
SQLite databases, drives enrollment and bidirectional Workspace mounting through
two browser contexts, executes Chat on each selected authority, reconciles
conversations created directly on either Node, restarts relayd, and restarts the
target Server. The journey is owned by the dedicated PR E2E job.

The physical two-host Work/tool-approval smoke, live grant revocation under
load, and migration-export evidence remain separate acceptance items. The
automated Chat journey does not claim those outcomes.
