# Fabric

This module owns Cradle's multi-Node control plane. A Fabric membership holds
only secret references, signed membership certificates, and the relay URL.
The relay directory receives Node metadata and authorization documents; all
workspace, chat, terminal, and provider bytes must go through the encrypted
Node link rather than a direct host address.

`service.ts` owns enrollment, owner approval, membership persistence, Node
listing, and link authorization. `directory-client.ts` owns the versioned
relayd HTTP protocol. `protocol.ts` is the TypeScript implementation of the
signed documents in `apps/relayd/internal/membership`.

`index.ts` exposes the local control routes (`/fabric`, `/fabric/managed-relay`, `/nodes`,
`POST /nodes/:nodeId/connect`) plus `ALL /nodes/:nodeId/upstream/*`, an
HTTP/SSE proxy resolved through the on-demand link manager.
`upstream-websocket.ts` bridges the matching WebSocket upgrades
(`/nodes/:nodeId/upstream/*`) to the Node's Cradle Server: frames flow both
ways, pre-open client frames are buffered, and close/error events propagate
with mapped close codes.
