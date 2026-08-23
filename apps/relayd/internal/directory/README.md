# Fabric directory

`directory` is relayd's control plane for Cradle Fabric. It owns signed Fabric
creation, Node and Controller join requests, Controller grants, filtered Node summaries, and
presence events. It must never receive, decode, persist, or log relay payload
bytes, workspace paths, prompts, provider identities, terminal output, or
credentials.

The Fabric owner key is the authorization root. A joining device creates and
signs its own request, keeps the raw delivery secret locally, and puts only the
SHA-256 hash in relayd. An owner-authenticated inbox lists pending requests.
Node approval issues Node and companion Controller certificates. Controller-only
approval issues one Node-restricted Controller certificate with explicit
grants. Relayd verifies the signed identity and atomically establishes its
principals and grants. Relayd never mints certificates or retains an owner key.

The language-neutral enrollment and wire contract lives in
[`protocol`](../../protocol/README.md).

Directory events are snapshot-first. A reconnect always receives the current
Node summary set before live events, so the implementation does not need a CRDT
or replicated session history. Admin Controllers share the authoritative
device directory; each summary carries only that Controller's active grant
scopes, and links remain grant-gated. Non-admin Controllers discover only
granted Nodes, with an optional certificate `nodeId` as a narrower boundary.

Node removal is an owner-only lifecycle operation. It deletes the device's
Node and Controller identity, removes all related grants, closes active links,
and publishes a `node.removed` directory event.
