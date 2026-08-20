# Fabric

Fabric owns Cradle's multi-Node control plane. Relayd stores directory and
authorization metadata, while Workspace, chat, terminal, provider, and file
bytes travel only through authenticated encrypted Node links.

| Area | Owner | Responsibility |
| --- | --- | --- |
| Membership and enrollment | [`service.ts`](./service.ts) | Persists one local Fabric membership, recovers pending enrollment, manages the owner approval inbox, and lists granted Nodes. |
| Signed protocol | [`protocol.ts`](./protocol.ts), [`directory-client.ts`](./directory-client.ts) | Signs membership documents and calls the versioned relayd directory API. |
| Controller links | [`node-link-manager.ts`](../relay-transport/node-link-manager.ts) | Opens one demand-driven encrypted tunnel to a selected Node and reuses it for upstream traffic. |
| Node connection | [`node-connector.ts`](../relay-transport/node-connector.ts) | Maintains the local Node's authenticated WebSocket and reconnects after relay or server interruption. |
| Local HTTP surface | [`index.ts`](./index.ts) | Exposes enrollment and Node routes, then proxies HTTP/SSE traffic through a resolved Node link. |
| Relay authority | [`apps/relayd`](../../../../relayd) | Persists Fabrics, Nodes, grants, and join requests; publishes presence and routes opaque envelopes. |

## Enrollment and authorization

The first device creates the Fabric owner key and enrolls itself as both a Node
and a Controller. A joining device submits its own identity and encryption
keys. The owner approves that exact request and returns two owner-signed
certificates: a Node certificate for the persistent Node socket and a
Controller certificate for directory and link operations.

Controller certificates identify a device but do not restrict it to that
device's Node. Admin Controllers share one authoritative device directory;
each Node summary reports the calling Controller's actual grant scopes. Relayd
grants remain the per-Node link authorization boundary. Non-admin Controllers
discover only granted Nodes. The target Node validates the owner signature,
Fabric, scope, and any optional Node restriction again before accepting
encrypted payloads.

Cancellation removes only the local pending membership and its Cradle-owned
identity keys. Relayd retains the short-lived join request until expiry. A
non-owner may leave locally; an owner cannot use that route because doing so
would orphan Fabric administration.

An owner can permanently remove any remote device with `DELETE
/nodes/:nodeId`. Relayd removes its Node and Controller identity, removes every
grant where it participates, and closes its live links. The route intentionally
has no generated CLI command because device removal is a destructive UI flow
with explicit confirmation.

## Routing and recovery

The browser always calls its local Cradle Server. `ALL
/nodes/:nodeId/upstream/*` resolves a Fabric link and forwards HTTP or SSE;
[`upstream-websocket.ts`](./upstream-websocket.ts) performs the equivalent
WebSocket bridge. Relayd never receives plaintext application payloads.

Membership changes start the Node connector without a server restart. At boot,
an existing membership reconnects automatically. A relay restart temporarily
marks Nodes offline; the connector re-establishes presence and existing mounted
Workspace routes become usable again without re-enrollment.

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
