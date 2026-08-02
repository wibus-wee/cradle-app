# Sandbox module (OrbStack / Docker sidecar pool)

Owns high-concurrency **sidecar sandboxes** for isolated environment testing
during Work. Cradle’s Agent and Chat Runtime stay on the host; sandboxes are
leased containers (OrbStack on macOS, Docker Engine elsewhere) that mount a
Work/session execution root and accept `exec` for tests and destructive
commands.

This is **not** Codex `sandboxMode`, and it is **not** the product “Work
container” aggregate. It does **not** schedule Claude turns or invent synthetic
UI runs.

## Ownership

| Owns | Does not own |
|---|---|
| Profiles, pool, leases, reconcile, exec | Chat Runtime turns / UI Runs |
| Docker/OrbStack adapter + mock runtime | Worktree git semantics |
| Scratch dirs under `CRADLE_DATA_DIR/sandboxes` | PR delivery / Work status |

**Read across:** Session (archiving hooks), Worktree (execution root path).
**Write within:** sandbox store + container engine labels.

Work may call into this module (`work → sandbox`). This module must not import
Work (avoids domain cycles).

## Architecture

1. **Warm pool** — idle containers per profile (`sleep infinity`, scratch mount
   only) keep image layers hot.
2. **Lease** — Docker bind mounts are create-time only, so a lease destroys one
   warm slot (if present) and creates a mounted leased container.
3. **Exec** — `docker exec` (or mock) runs a command with timeout; request /
   response only.
4. **Release / TTL / reconcile** — explicit release, idle TTL reclaim, and
   maintenance reconcile of Cradle-labeled orphans.

## Default profiles

| Id | Image | Network |
|---|---|---|
| `node22` | `node:22-bookworm-slim` | `none` |
| `python312` | `python:3.12-slim-bookworm` | `none` |

Override via `CRADLE_SANDBOX_PROFILES_PATH` or
`$CRADLE_DATA_DIR/sandbox-profiles.json`.

## Pool config (env)

| Env | Default |
|---|---|
| `CRADLE_SANDBOX_MIN_WARM` | `1` |
| `CRADLE_SANDBOX_MAX_TOTAL` | `16` |
| `CRADLE_SANDBOX_MAX_PER_WORK` | `4` |
| `CRADLE_SANDBOX_EXEC_TIMEOUT_MS` | `30000` |
| `CRADLE_SANDBOX_RUNTIME` | unset → `docker-cli`; `mock` for tests |
| `CRADLE_SANDBOX_DOCKER_BIN` | `docker` |

## HTTP / CLI

| Method | Path | CLI |
|---|---|---|
| GET | `/sandboxes/profiles` | `sandbox profiles` |
| GET | `/sandboxes/pool` | `sandbox pool` |
| GET | `/sandboxes/leases` | `sandbox leases` |
| POST | `/sandboxes/leases` | `sandbox lease` |
| POST | `/sandboxes/leases/:id/exec` | `sandbox exec` |
| POST | `/sandboxes/leases/:id/release` | `sandbox release` |
| POST | `/sandboxes/reconcile` | `sandbox reconcile` |
| GET | `/works/:id/sandboxes` | `work sandboxes` |
| POST | `/works/:id/sandboxes/lease` | `work sandbox-lease` |

## Persistence

Lease/instance facts live in `$CRADLE_DATA_DIR/sandboxes/state.json` (atomic
rename). No Drizzle migration for this POC. Engine truth is reconciled through
labels: `cradle.sandbox=1`, `cradle.sandbox.profile`,
`cradle.sandbox.instance`, `cradle.sandbox.lease`,
`cradle.sandbox.pool_state`.

## Security notes

- Host Docker socket is **never** mounted into sandbox containers.
- Default network is `none`; opt into `bridge` per lease when installs need net.
- Default worktree mount is **read-only**; pass `mountWritable: true` explicitly.

## Files

- `runtime/` — `docker-cli` adapter + in-memory `mock`
- `profiles.ts` — profile + pool config
- `store.ts` — JSON snapshot
- `service.ts` — lease/exec/reconcile
- `maintenance.ts` — Maintenance task registration
- `index.ts` — Elysia routes + session hooks
