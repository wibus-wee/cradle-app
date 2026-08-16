# Fabric store

The Fabric store is the durable SQLite metadata layer for relayd. It contains
only Fabric ownership keys, public member keys, Node summaries, grants, signed
join requests, revocations, and presence timestamps.

It is intentionally separate from `internal/relay`: relay envelopes and their
encrypted payloads do not enter this package. A relay restart keeps directory
records and marks all Nodes offline until their persistent connections return.
