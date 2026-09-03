# Fabric

Fabric owns Cradle's multi-Node control plane. Relayd stores directory and
authorization metadata, while Workspace, chat, terminal, provider, and file
bytes travel only through authenticated encrypted Node links.

| Area | Owner | Responsibility |
| --- | --- | --- |
| Membership and enrollment | [`service.ts`](./service.ts) | Persists one local Fabric membership, recovers pending Node enrollment, manages Node and Controller owner approval inboxes, and lists granted Nodes. |
| Signed protocol | [`protocol.ts`](./protocol.ts), [`directory-client.ts`](./directory-client.ts) | Signs membership documents and calls the versioned relayd directory API. |
| Controller links | [`node-link-manager.ts`](../relay-transport/node-link-manager.ts) | Opens one demand-driven encrypted tunnel to a selected Node and reuses it for upstream traffic. |
| Node connection | [`node-connector.ts`](../relay-transport/node-connector.ts) | Maintains the local Node's authenticated WebSocket and reconnects after relay or server interruption. |
| Local HTTP surface | [`index.ts`](./index.ts) | Exposes enrollment, managed Relay resource, and Node routes, then proxies HTTP/SSE traffic through a resolved Node link. |
| Relay authority | [`apps/relayd`](../../../../relayd) | Persists Fabrics, Nodes, grants, and join requests; publishes presence and routes opaque envelopes. |

## Enrollment and authorization

The first device creates the Fabric owner key and enrolls itself as both a Node
and a Controller. A joining device submits its own identity and encryption
keys. The owner approves that exact request and returns two owner-signed
certificates: a Node certificate for the persistent Node socket and a
Controller certificate for directory and link operations.

A Controller-only client submits the same self-signed join document with
`subjectKind: controller`. The owner approves explicit `view`, `control`, or
`approve` grants for one or more Nodes, including `control` on at least one
Node. The resulting Fabric-level Controller certificate omits `nodeId`; active
grants remain the only per-Node authorization boundary, and approval creates no
Node record. The complete cross-language contract is
[`apps/relayd/protocol`](../../../../relayd/protocol/README.md).

Controller certificates identify a device and its coarse Fabric capabilities.
Admin Controllers share one authoritative device directory; each Node summary
reports the calling Controller's actual grant scopes. Non-admin Controllers
discover only granted Nodes, and link opening checks an active `control` grant.
The target Node validates the owner signature, Fabric, and scope again before
accepting encrypted payloads.

Cancellation removes only the local pending membership and its Cradle-owned
identity keys. Relayd retains the short-lived join request until expiry. A
non-owner may leave locally; an owner cannot use that route because doing so
would orphan Fabric administration.

An owner can permanently remove any remote device with `DELETE
/nodes/:nodeId`. Relayd removes its Node and Controller identity, removes every
grant where it participates, and closes its live links. The route intentionally
has no generated CLI command because device removal is a destructive UI flow
with explicit confirmation.

An owner can remove one Node permission with `DELETE
/nodes/:nodeId/grants/:grantId`, or permanently revoke a non-admin Controller
and all of its Fabric permissions with `DELETE
/fabric/controllers/:controllerId`. Both operations close affected live links.
The Web access dialog keeps these meanings separate with a second confirmation
before whole-Controller revocation. Admin companion Controllers remain owned by
their Node and cannot be revoked through the Controller route.

## Routing and recovery

The browser always calls its local Cradle Server. `ALL
/nodes/:nodeId/upstream/*` resolves a Fabric link and forwards HTTP or SSE;
[`upstream-websocket.ts`](./upstream-websocket.ts) performs the equivalent
WebSocket bridge. Relayd never receives plaintext application payloads.

Membership changes start the Node connector without a server restart. At boot,
an existing membership reconnects automatically. A relay restart temporarily
marks Nodes offline; the connector re-establishes presence and existing mounted
Workspace routes become usable again without re-enrollment.

Desktop passes the managed relayd process ID to the Server at launch.
`GET /fabric/managed-relay/resources` samples that local process tree for the
development resource panel, including the child executable started by `go run`.
External Relays are reported as external and are never included in this host's
memory or CPU totals.

Fabric membership, Node presence, grant authorization, and a live encrypted
link are separate states. A Node can therefore be visible and online before an
upstream Workspace request succeeds. User-facing callers must preserve upstream
errors and only report an empty Workspace inventory after a successful response.

The executable two-Node acceptance test is
[`CRADLE-FABRIC-001`](../../../../../e2e/src/fabric/fabric-two-node.spec.ts).
It runs relayd, two Cradle Servers with independent databases, and two browser
contexts; then verifies UI enrollment, bidirectional Workspace mounting and
chat, cross-controller Session discovery, relay restart, and target-server
restart. It also re-enrolls one device to create a stale directory record,
asserts both admins see the same three Node IDs, removes the stale device
through the owner UI, and asserts both directories converge to the same two
Node IDs. Run it with `pnpm e2e:fabric`.

The native Controller acceptance test is
[`CRADLE-FABRIC-002`](../../../../../e2e/src/fabric/fabric-two-node.spec.ts).
It installs the signed Release Mobile app on an ephemeral iOS Simulator, enrolls
it through the owner UI, grants two Nodes, switches a real Workspace and Codex
Chat stream between them, and verifies per-Node and whole-Controller revocation.
Run it on macOS with `pnpm e2e:fabric:mobile:ios`; artifacts are retained under
`e2e/artifacts/mobile-fabric/`.
