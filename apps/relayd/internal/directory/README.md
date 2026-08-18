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
authorized Node summary set before live events, so the implementation does not
need a CRDT or replicated session history.
