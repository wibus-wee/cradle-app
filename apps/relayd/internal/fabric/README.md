# Fabric store

The Fabric store is the durable SQLite metadata layer for relayd. It contains
only Fabric ownership keys, public member keys, Node summaries, grants, signed
join requests, revocations, and presence timestamps.

It is intentionally separate from `internal/relay`: relay envelopes and their
encrypted payloads do not enter this package. A relay restart keeps directory
records and marks all Nodes offline until their persistent connections return.

Join approval stores both owner-signed certificates and creates full-mesh
`admin` grants for the personal Fabric in the same transaction. Pending and
rejected requests remain metadata-only and never expose their raw delivery
secret.

At startup, the store repairs missing full-mesh grants for personal devices
enrolled by versions that predate that transaction. The repair is idempotent:
any existing grant row is authoritative, so revoked or deliberately narrowed
access is never recreated or widened. Each affected Fabric advances its
directory revision once after all missing grants are inserted.

Admin Controllers receive the same authoritative Fabric Node directory, while
each summary still reports only that Controller's active grant scopes. Grants
continue to authorize links; they do not hide device existence from an admin.
Owner-authenticated removal deletes the Node identity and all grants where the
device is either Node or Controller, making old certificates unusable.
