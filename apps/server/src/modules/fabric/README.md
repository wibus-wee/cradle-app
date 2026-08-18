# Fabric

This module owns Cradle's multi-Node control plane. A Fabric membership holds
only secret references, signed membership certificates, and the relay URL.
The relay directory receives Node metadata and authorization documents; all
workspace, chat, terminal, and provider bytes must go through the encrypted
Node link rather than a direct host address.

`service.ts` owns enrollment, pending-enrollment recovery and cancellation,
the owner approval inbox, membership persistence, Node listing, and link
authorization. Cancellation removes only the local pending membership and its
Cradle-owned identity keys; relayd retains the short-lived join request until
it expires. A non-owner device may also leave its active Fabric locally; owners
cannot use that route because it would orphan Fabric administration.
`directory-client.ts` owns the versioned relayd HTTP protocol. `protocol.ts` is
the TypeScript implementation of the signed documents in
`apps/relayd/internal/membership`.

`index.ts` exposes the local control routes (`/fabric`,
`/fabric/managed-relay`, `/fabric/node-invitations/pending`, `/nodes`,
`POST /nodes/:nodeId/connect`) plus `ALL /nodes/:nodeId/upstream/*`, an HTTP/SSE
proxy resolved through the on-demand link manager. The owner-only enrollment
routes list pending requests and approve or reject them by request id. Approval
returns both Node and Controller certificates so the joining device can use
the same directory and Workspace surfaces as the original device.
`upstream-websocket.ts` bridges the matching WebSocket upgrades
(`/nodes/:nodeId/upstream/*`) to the Node's Cradle Server: frames flow both
ways, pre-open client frames are buffered, and close/error events propagate
with mapped close codes.
