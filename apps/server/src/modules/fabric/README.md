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
