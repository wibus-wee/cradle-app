# Fabric directory

`directory` is relayd's control plane for Cradle Fabric. It owns signed Fabric
creation, Node join requests, controller grants, filtered Node summaries, and
presence events. It must never receive, decode, persist, or log relay payload
bytes, workspace paths, prompts, provider identities, terminal output, or
credentials.

The Fabric owner key is the authorization root. A Node creates and signs its
own join request, keeps the raw delivery secret locally, and puts only the
SHA-256 hash in relayd. An owner-authenticated inbox lists pending requests.
Approval signs the exact identity into Node and Controller certificates;
relayd verifies both and atomically establishes the device's directory grants.
Relayd never mints membership certificates or retains an owner key.

Directory events are snapshot-first. A reconnect always receives the current
Node summary set before live events, so the implementation does not need a CRDT
or replicated session history. Admin Controllers share the authoritative
device directory; each summary carries only that Controller's active grant
scopes, and links remain grant-gated. Non-admin Controllers discover only
granted Nodes, with an optional certificate `nodeId` as a narrower boundary.

Node removal is an owner-only lifecycle operation. It deletes the device's
Node and Controller identity, removes all related grants, closes active links,
and publishes a `node.removed` directory event.
