# Ship Mobile as a production Fabric Controller

This ExecPlan is a living document. `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must remain current as work
proceeds. It follows the repository's established ExecPlan structure; the
historical global ExecPlan reference named by older plans is not installed in
this checkout.

## Purpose / Big Picture

After this work, Cradle Mobile joins a Fabric as a Controller, discovers every
Node authorized by its grants, selects a Node without knowing that Node's LAN
address or Server credential, and uses the existing Cradle HTTP and SSE APIs
through an end-to-end encrypted Fabric link. Enrollment, authorization,
revocation, foreground/background recovery, offline state, and multiple Node
selection are complete product workflows rather than development-only paths.

The existing direct Server URL and bearer-token connection remains only as an
explicit development transport while the migration is exercised. Production
Mobile onboarding defaults to Fabric and stores no Cradle Server bearer token.
Relayd continues to see directory metadata and opaque route envelopes only; it
never becomes a plaintext Mobile API proxy.

## Component Map

| Area | Owner | Responsibility | Production acceptance |
| --- | --- | --- | --- |
| Wire contract | `packages/fabric-protocol` and `apps/relayd/protocol` | Canonical membership types, signed JSON, Fabric envelopes, Session frames, crypto negotiation, and flow control. | Server and Mobile share fixtures and reject malformed, replayed, or certificate-mismatched traffic. |
| Directory authority | `apps/relayd/internal/{membership,fabric,directory}` | Persist principals and per-Node grants, filter discovery, authorize links, revoke live access. | A Controller can receive grants for multiple Nodes without admin authority; every link is grant-gated. |
| Server Fabric API | `apps/server/src/modules/fabric` | Owner approval, Controller grant management, and Node-side link lifecycle. | HTTP contracts expose complete approval and revocation semantics with focused tests and current README documentation. |
| Owner UI | `apps/web/src/features/nodes` | Review Controller identity, choose Nodes/scopes, approve or reject, and inspect/revoke access. | A fixture-driven View renders loading, empty, error, approval, and revocation states without application dependencies. |
| Mobile membership | `apps/mobile/src/features/fabric` | Pairing, key and certificate lifecycle, directory state, Node selection, revocation, and recovery. | Relaunch restores membership; rejection, expiry, invalid trust root, revocation, and offline Nodes have explicit states. |
| Mobile transport | `apps/mobile/src/lib/transport` | Authenticated WebSocket, Fabric Session, HTTP/1.1 byte streams, SSE bodies, cancellation, and bounded retry. | Existing feature requests run unchanged through the selected Node; mutations and partial streams are never replayed. |

## Progress

- [x] (2026-08-30 16:05+08:00) Reconciled the proposed Mobile direction with current relayd, Server, Web, and Mobile source.
- [x] (2026-08-30 16:12+08:00) Confirmed that relayd already owns Controller-only enrollment, signed directory requests, grant-gated link opening, and the portable AES-256-GCM/no-compression Session baseline.
- [x] (2026-08-30 16:24+08:00) Created this production delivery plan and fixed ownership, trust, multi-Node, transport, and recovery acceptance boundaries.
- [x] (2026-08-31 00:47+08:00) Extracted the platform-neutral Fabric membership, envelope, Session codec, crypto, and full flow-control state machine into `packages/fabric-protocol`; Server adapters now inject Node randomness and Zstandard only.
- [x] (2026-08-31 00:34+08:00) Replaced the Controller-only single-Node certificate restriction with atomic, grant-scoped multi-Node authorization across relayd and Server contracts.
- [x] (2026-08-31 01:02+08:00) Completed Server/OpenAPI and Web owner workflows for Controller inbox approval, explicit per-Node scopes, identity fingerprint review, named grant audit, and confirmed revocation.
- [x] (2026-08-31 01:36+08:00) Implemented Mobile trust bootstrap, Controller enrollment, device-only secure key persistence, certificate validation, directory refresh, and explicit multi-Node selection.
- [x] (2026-08-31 01:51+08:00) Implemented the Mobile Fabric Session and HTTP/SSE bridge, migrated request ownership to typed transports, and scoped query/chat caches by Fabric and Node identity.
- [x] (2026-08-31 02:01+08:00) Completed foreground/background lifecycle, single-flight link recovery, cancellation, bounded safe-read retry, grant loss, and whole-Controller revocation behavior.
- [x] (2026-08-31 02:18+08:00) Completed focused protocol, relayd, Server, Web, Mobile, lockfile, iOS bundle, and codec-performance verification; updated stable owner READMEs and this delivery record.
- [x] (2026-08-31 13:45+08:00) Added and passed `CRADLE-FABRIC-002`, a signed Release iOS Simulator journey covering native enrollment, two-Node selection, Workspace cache isolation, Codex Chat SSE, one-grant removal, and whole-Controller revocation; added its dedicated macOS CI job and owner documentation.

## Surprises & Discoveries

- Observation: the generic relayd grant store already supports many
  `node_grants` per Controller, but Controller-only enrollment requires a
  certificate `nodeId` and validates every initial grant against it.
  Evidence: `apps/relayd/internal/fabric/store.go` separates generic
  `registerControllerInTx` from the narrower `validateControllerEnrollment`.
- Observation: `node_grants` references Node IDs but did not prove that a grant's
  `fabric_id` matched the target Node's Fabric before insertion.
  Evidence: the schema has a foreign key on `node_id` only. Controller
  registration now validates `(fabric_id, node_id)` inside the approval
  transaction before persisting the principal or any grant.
- Observation: invoking the workspace package-manager wrapper stalled in this
  checkout, while the pinned pnpm 11.24 executable works with the local virtual
  store disabled.
  Evidence: protocol dependencies installed successfully with the pinned
  executable and offline store; verification uses package-local binaries until
  the wrapper environment is repaired.
- Observation: Server APIs already list, approve, and reject pending Controller
  requests, while the Web Node settings feature consumes only Node enrollment
  request endpoints.
  Evidence: `apps/server/src/modules/fabric/index.ts` exposes
  `/controller-invitations/requests`; no non-generated Web source references
  those routes.
- Observation: relayd grant records exposed only `controllerId`, even though an
  approved Controller join request retains its display name.
  Evidence: `ListNodeGrants` now returns the exactly matched approved join
  identity as `controllerDisplayName`; legacy direct registrations explicitly
  fall back to their Controller ID in the Web UI without a schema migration.
- Observation: Mobile's transport identity is the Server URL. React Query keys
  and persisted chat history also include that URL, so changing only
  `cradleRequest` would allow cross-Node cache collisions or stale data.
  Evidence: `apps/mobile/src/lib/api.ts` defines `ServerConnection`, and feature
  query keys plus `chat-history-cache.ts` use `connection.url`.
- Observation: the current Server Session implementation mixes portable
  protocol state with Node-only `node:crypto`, Zstandard, TCP, and Server
  `AppError` dependencies. Mobile must not import that module directly.
  Evidence: `apps/server/src/modules/relay-transport/{session,crypto,compression,controller-transport}.ts`.
- Observation: React Native's WebSocket implementation accepts native request
  headers, so relay authentication does not need to appear in a URL or
  subprotocol.
  Evidence: the Mobile link manager passes signed Fabric headers through the
  React Native WebSocket constructor and keeps link tokens out of persisted
  state.
- Observation: extracting AES-GCM into a portable implementation caused the
  Server bulk-codec benchmark to fall below its existing regression floor.
  Evidence: the isolated benchmark failed with portable AES near 40 MiB/s
  against the XChaCha baseline near 156 MiB/s. The shared Session now accepts a
  cipher factory; Server injects Node-native AES-GCM while Mobile retains the
  portable implementation. The isolated benchmark passes after that split.
- Observation: the Web Controller pairing payload omitted the protocol version
  that Mobile correctly requires before trusting the owner key.
  Evidence: the first native enrollment run rejected the displayed owner code;
  Web now emits the shared versioned pairing contract and has a focused fixture
  test.
- Observation: React Native's `whatwg-fetch` Response stringifies an application
  `ReadableStream` body as `[object ReadableStream]`, and its stream scheduling
  differs from the Node test implementation.
  Evidence: the first real Workspace response reached Mobile but failed JSON
  parsing. The Fabric HTTP codec now owns a fetch-compatible single-reader body
  queue, including pending reads, cancellation, failure, and flow-control ACKs;
  focused JSON and SSE timing tests cover both data-before-read and read-before-data.
- Observation: iOS Simulator SecureStore still requires a Keychain access-group
  entitlement, and Maestro cannot inspect text rendered only inside the custom
  UIKit Markdown view without accessibility semantics.
  Evidence: native runs first failed with `A required entitlement is not present`
  and later displayed the correct Chat reply outside the accessibility tree.
  The Expo/native entitlements now agree, and native Markdown exposes its text
  to VoiceOver and automation.
- Observation: a synchronous Maestro child process blocks the Playwright worker
  that also hosts the model API simulator.
  Evidence: the native Chat request remained `Working` until Maestro exited even
  though other Fabric calls succeeded. Maestro flows now run asynchronously so
  the scripted Codex stream can progress concurrently.

## Decision Log

- Decision: Mobile is a first-class Fabric Controller, not a proxy client of a
  designated Cradle Server.
  Rationale: Node discovery and authorization belong to Fabric; Workspace,
  Session, Chat, terminal, and file semantics remain owned by the selected Node.
  Date/Author: 2026-08-30 / Codex
- Decision: Controller certificates identify the Controller and bound allowed
  scopes, while durable grants authorize individual Nodes. Controller-only
  certificates will no longer encode one permanent Node restriction.
  Rationale: keeping both certificate `nodeId` and grants as overlapping
  authorization sources prevents a production Mobile Controller from receiving
  additional Node access without re-enrollment.
  Date/Author: 2026-08-30 / Codex
- Decision: pairing must pin the Fabric owner public key in addition to
  `relayUrl` and `fabricId`.
  Rationale: signed certificates protect an untrusted relay only when the
  joining Controller already knows which owner key is authoritative.
  Date/Author: 2026-08-30 / Codex
- Decision: portable codecs, cryptographic derivation, and Session state move to
  a shared package with injected cipher, compression, randomness, and error
  adapters where platform behavior differs.
  Rationale: copying the Server state machine into Mobile would create two wire
  implementations that can drift; importing Server modules would leak Node-only
  runtime dependencies across the ownership boundary.
  Date/Author: 2026-08-30 / Codex
- Decision: Mobile's API boundary becomes a typed transport interface. Existing
  feature Containers keep calling `cradleRequest` and consuming standard
  `Response` bodies while the selected transport owns request serialization.
  Rationale: endpoint semantics do not change when the connection path changes,
  and feature code must not learn Fabric framing or authentication.
  Date/Author: 2026-08-30 / Codex
- Decision: automatic retry is limited to a bodyless idempotent request that
  failed before response headers. Mutations, request bodies, and any partially
  observed response are never replayed.
  Rationale: a transport cannot prove whether a remote mutation executed after
  a link failure.
  Date/Author: 2026-08-30 / Codex
- Decision: Controller-only approval requires at least one `control` grant and
  certificate scopes equal the exact union of submitted grant scopes.
  Rationale: an enrolled Mobile Controller must be capable of opening at least
  one application link, and the certificate must not retain dormant authority
  beyond its initial grant set.
  Date/Author: 2026-08-31 / Codex
- Decision: Mobile private identity material is available only through native
  secure storage with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the Web build has no
  secret-storage fallback.
  Rationale: persisting Controller keys in AsyncStorage or browser storage
  would turn a convenience build into a weaker production trust model.
  Date/Author: 2026-08-31 / Codex
- Decision: revoking a Controller principal is distinct from removing one Node
  grant and is a two-step owner action.
  Rationale: a per-Node revocation should preserve other grants, while principal
  revocation must atomically invalidate every grant, close live links, and
  prevent the same certificate from registering again.
  Date/Author: 2026-08-31 / Codex
- Decision: native Mobile acceptance uses Maestro for the signed iOS app and
  Playwright for the Fabric owner UI inside one dedicated two-Node topology.
  Rationale: the product boundary spans native secure storage and navigation,
  Web approval, relay authorization, Node routing, and provider streaming; one
  orchestrated journey verifies those owners without replacing any with mocks.
  Date/Author: 2026-08-31 / Codex

## Context and Orientation

Relayd's directory routes under `apps/relayd/internal/directory` authenticate
canonical request proofs with owner-signed membership certificates. A
Controller lists granted Nodes, asks relayd to open a transient link, then
connects an authenticated WebSocket. The Node maintains a separate persistent
WebSocket. Relayd reads the outer Fabric route fields and forwards opaque
payload bytes.

Fabric Session v2 runs inside those route envelopes. The Controller initiates a
certificate-bound X25519 handshake, negotiates an AEAD and compression mode,
then multiplexes credit-limited byte streams. Each stream maps to one HTTP/1.1
connection at the target Node. The Node strips caller-provided relay
credentials, injects its local tunnel credential, and returns raw HTTP response
bytes, including streaming bodies.

Mobile now owns either a Fabric or explicit development connection through a
typed transport boundary. Fabric resource identities are `(fabricId, nodeId)`,
and both React Query keys and persisted chat history use that identity. Feature
Containers continue to consume the existing Cradle API response contracts and
do not know about relay framing, link authentication, or HTTP serialization.

## Implemented Design

`packages/fabric-protocol` is the sole TypeScript owner of signed
membership documents, Base64 and canonical JSON rules, Fabric v3 envelopes,
Fabric Session v2 frames, key derivation, and stream state. The Go schema and
protocol README remain the language-neutral authority. Server and Mobile use
the shared package, with platform behavior supplied through explicit adapters.

Controller identity is independent of one Node. Controller enrollment
approval accepts a non-empty set of Node grants and non-admin scopes; relayd
verifies every Node exists in the Fabric and every grant scope is present in
the certificate. Directory listing and link opening continue to consult active
grants. Existing Node+Controller personal-device certificates remain admin and
unrestricted. Protocol schema, Go validation, Server models, focused tests, and
current-state documentation describe the same grant model.

The complete owner workflow is exposed through the Web Node settings feature.
The dependency-owning Container loads pending Controller requests and Nodes,
submits selected grants, and invalidates directory/grant caches. A separate
`*View` receives typed fixtures and semantic callbacks. Approval uses checkboxes
for Nodes and scopes, shows the Controller identity fingerprint and expiry, and
requires at least one Node with `control`. Grant revocation remains an explicit
destructive confirmation, and principal revocation has a separate two-step
confirmation.

Mobile owns Fabric membership. Pairing accepts a versioned code
containing `relayUrl`, `fabricId`, and `ownerPubkey`; Mobile generates Ed25519
and X25519 keys, submits a signed Controller join request, and polls with its
delivery secret. Private keys live in platform secure storage. Public metadata,
pending state, certificate, grants, selected Node, and schema version live in a
single migration-aware store. Approval completion validates owner signature,
subject, identity key, encryption key, Fabric, scopes, and expiry before commit.

Authenticated directory calls use a reusable selected-Node link manager.
Directory snapshots are authoritative after reconnect. The link
manager single-flights concurrent opens, binds the returned Node certificate to
the pinned owner, performs the Session handshake, and closes all streams when
the app backgrounds or access is revoked. Foreground resume relists Nodes before
opening demand-driven links.

The Fabric HTTP transport writes one connection-close
HTTP/1.1 request per Session stream, incrementally parses the status line and
headers within fixed limits, and exposes the body through a backpressured,
fetch-compatible single-reader queue. Content-Length, chunked bodies,
connection-close bodies, SSE, cancellation, non-2xx bodies, and truncated
responses receive focused tests.
`cradleRequest` selects this transport without changing feature endpoint calls.
Queries and persisted chat history use a `fabricId/nodeId` resource identity.

Focused fixtures cover canonical signatures, binary framing, crypto negotiation,
flow control, HTTP fragmentation, cancellation, retry eligibility, storage
migration, and cache separation. Relayd and Server tests cover multi-Node
authorization and revocation. Web and Mobile typecheck/lint run with focused
tests. `CRADLE-FABRIC-001` retains the two-browser Node-to-Node boundary, while
`CRADLE-FABRIC-002` installs the signed Release Mobile app on an ephemeral iOS
Simulator and drives the native Controller boundary with Maestro.

## Validation and Acceptance

Acceptance requires all of the following observable behaviors:

- One Mobile Controller is approved once, receives access to at least two Nodes,
  lists only its granted Nodes, and opens links to both without re-enrollment.
- Removing one Node grant closes that live link and leaves access to the other
  Node intact. Revoking the Controller makes all later directory and link
  requests fail closed.
- Relaunch restores a valid membership without a Server token. An expired,
  mismatched, or wrongly signed approval is discarded rather than persisted.
- Existing Work, Workspace, Usage, Chat request, Chat SSE, cancellation, and
  session-summary event paths operate through the selected Node.
- A Node switch produces distinct query and persisted-chat cache identities.
- A relay or Node interruption yields a bounded offline/reconnecting state.
  Bodyless reads may retry once before headers; mutations and observed streams
  never replay.
- Session flow control bounds unacknowledged bytes per stream and link, and a
  slow response consumer cannot grow Mobile memory without limit.
- Relayd receives no HTTP paths, headers, prompts, response bodies, Server
  tokens, or decrypted application bytes.

The final focused verification set is:

    go test ./internal/membership ./internal/fabric ./internal/directory ./internal/relay
    vitest run packages/fabric-protocol/src/{protocol,session}.test.ts
    vitest run apps/mobile/src/lib/transport/{fabric-http-codec,fabric-http-transport,fabric-retry-policy}.test.ts
    vitest run apps/server/tests/fabric-node-grants.test.ts apps/server/tests/relay-transport/{crypto,session,compression,protocol,websocket-data}.test.ts
    vitest run apps/server/tests/relay-transport/codec-throughput-benchmark.test.ts
    tsc --noEmit -p packages/fabric-protocol/tsconfig.json
    tsc --noEmit -p apps/{server,web,mobile}/tsconfig.json
    tsx apps/server/scripts/check-module-boundaries.ts
    tsx apps/server/scripts/check-stream-enqueue-boundary.ts
    eslint <changed TypeScript and TSX files>
    expo export --platform ios
    pnpm e2e:fabric:mobile:ios
    pnpm install --lockfile-only --frozen-lockfile --offline
    git diff --check

## Idempotence and Recovery

Enrollment request IDs and approval delivery are idempotent. A pending Mobile
membership is committed only after full certificate validation; cancellation
removes only Cradle-owned local keys and pending metadata. Directory snapshots
replace cached presence state after reconnect. Link generations are disposable:
every terminal WebSocket path closes streams and clears the single-flight latch,
so a later demand can create one new generation.

The protocol extraction was fixture-first. Server and Mobile now import the
same binary and signed-JSON implementation; only platform adapters for secure
randomness, AEAD acceleration, compression, socket I/O, and secure persistence
remain outside the shared owner. There is no compatibility path running a
second Session implementation.

## Outcomes & Retrospective

The branch now contains the complete production architecture rather than a
single-Node MVP. Mobile enrolls as a Controller, validates the pinned Fabric
owner, discovers and selects among all granted Nodes, carries unchanged Cradle
HTTP and SSE traffic over an encrypted multiplexed link, separates per-Node
caches, and recovers across foreground, background, network interruption,
single-grant removal, and principal revocation. Direct Server access remains an
explicit development connection and cannot silently supersede Fabric state.

Automated verification passed for the shared protocol, Mobile HTTP/retry and
stream timing suites, Server Fabric/relay suites, the isolated relay codec
performance guard, and the focused relayd packages. Shared, Server, Web, and
Mobile typechecks and focused ESLint passed. A frozen offline lockfile check,
both Server boundary checks, CocoaPods deployment install, and the iOS bundle
also passed.

`CRADLE-FABRIC-002` passed against a signed Release iOS app, real local relayd,
two independent Server databases, the owner Web UI, and a real Codex app-server
backed by the deterministic provider simulator. The run proved native secure
enrollment, two grants, Node-scoped Workspace state, Node switching, streaming
Chat continuation, one-grant loss, and terminal Controller revocation. Physical
device carrier-network transitions and OS background scheduling remain release
QA because a Simulator cannot reproduce those operating-system conditions.

Revision note (2026-08-30): Created after current-source inspection and expanded
the requested Mobile Fabric work from a single-Node MVP into a production,
multi-Node Controller delivery plan.

Revision note (2026-08-31): Added the shared TypeScript protocol package,
migrated Server membership/envelope/frame codecs, and completed Fabric-level
Controller certificates with atomic multi-Node grants. Focused relayd tests,
Server typecheck, 16 Server Fabric route tests, 17 Server relay-transport tests,
and three shared protocol tests pass.

Revision note (2026-08-31): Completed the Owner Controller workflow with
fixture-driven Web views, explicit Node/scope selection, identity fingerprint,
Controller display names, and confirmed grant revocation. Shared protocol and
relayd tests, Server and Web typechecks, focused ESLint, the default i18n
baseline, and 16 Server Fabric route tests pass. The repository-wide translation
audit still reports its pre-existing incomplete locale corpus and remains a
separate localization concern.

Revision note (2026-08-31): Completed Mobile membership, multi-Node selection,
encrypted HTTP/SSE transport, lifecycle recovery, cache migration, grant and
principal revocation, and platform-specific crypto adapters. Recorded focused
test, performance, type, lint, lockfile, and iOS bundle evidence plus the
remaining physical-device release QA boundary.

Revision note (2026-08-31): Added the native iOS production acceptance runner,
Maestro flows, macOS CI job, Keychain capability, Markdown accessibility seam,
React Native-safe streaming response body, and `CRADLE-FABRIC-002` evidence.
