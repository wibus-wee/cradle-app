# Relay Servers

This module owns Cradle's relay server registry.

Relay server rows are Cradle application data stored in `relay_servers`. A row names a relay URL,
whether it is enabled, and whether it is the default relay used by remote host pairing when
the request does not specify a relay server id.

Only this module writes the relay server registry and owns relay token signing secret resolution.
Other modules may read it to resolve relay URLs or mint relay tokens, but they should not duplicate
default-selection, lifecycle, or HMAC secret semantics.

## Built-in Local Relayd

`local-relayd-supervisor.ts` owns the local development relayd process launched by Cradle Server.
It is a local convenience for desktop/dev use:

- `CRADLE_RELAYD_AUTOSTART=0|false|no` disables it.
- `CRADLE_RELAYD_AUTOSTART=1|true|yes` forces it on.
- Without an explicit value, it starts outside `test` and `production`.
- `CRADLE_RELAYD_PATH` points at an explicit relayd executable.
- Packaged Desktop resolves `process.resourcesPath/relayd/<platform>-<arch>/relayd`.
- Dev source trees fall back to `go run ./cmd/relayd` from `apps/relayd`.

When the managed relayd is ready, the supervisor upserts the system row
`system:local-relayd` with display name `Built-in local relay`. It becomes default only when no
explicit default exists, so user-selected public relay servers remain authoritative.

The supervisor injects Cradle Server's resolved relay HMAC secret into the relayd child process via
`CRADLE_RELAYD_DEV_HMAC_SECRET`, so the managed relay always validates the tokens minted by the same
server process.

The built-in local relay URL is loopback-only. Real remote machines still need a relay URL reachable
from both sides.

The built-in HMAC secret fallback is non-production only. Production deployments must set
`CRADLE_RELAY_HMAC_SECRET` on Cradle Server and `CRADLE_RELAYD_DEV_HMAC_SECRET` (or
`CRADLE_RELAY_HMAC_SECRET`) for relayd.

## Routes

- `GET /relay-servers`: list relay servers.
- `POST /relay-servers`: create a relay server.
- `PATCH /relay-servers/:relayServerId`: update a relay server.
- `DELETE /relay-servers/:relayServerId`: delete a relay server.

All routes include `x-cradle-cli` metadata under the `relay-server` command namespace.
