# ACP Module

HTTP-first ACP management capability for registry browsing, package-distribution installation resources, installed-agent inventory (registry + local), launch overrides, draft-session model discovery, and audit queries.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

Binary distributions are available whenever the official registry supplies a target for the current platform. The server Download Center owns transfer, byte limits, optional checksum verification, retry, and artifact cleanup; ACP owns archive extraction and installation. Registry checksums are used when supplied but are not required for binary installation.

## Source model

| `source` | Base launch (`cmd` / `args` / `env` / `distribution_type`) | Overrides (`override_*`) | Install via `PUT …/installation` |
| --- | --- | --- | --- |
| `registry` | Owned by installer on install/reinstall | User via `PATCH …/launch-config` | Allowed |
| `local` | Owned by user on create/PATCH | Always null | **409** `acp_local_not_installable` |

`distribution_type` application values: `binary` | `npx` | `uvx` | `command`.

- `command`: direct `spawn(cmd, args)` (local absolute binaries or PATH names).
- `binary`: resolve under `installPath` (absolute `cmd` allowed; relative must stay under install root).
- `npx` / `uvx`: package wrappers (unchanged).

## Effective launch merge

Implemented in `launch-config.ts` (`resolveEffectiveLaunch`):

1. `cmd = overrideCmd ?? cmd ?? ''`
2. `args = overrideArgs != null ? parse(overrideArgs) : parse(args)` (empty `[]` is a valid full replace)
3. `env = overrideEnv != null ? { ...baseEnv, ...overrideEnv } : baseEnv` (shallow merge)
4. `distributionType` / `installPath` always from base columns

Resolve (`chat-runtime-providers/acp/config.ts`) requires `status === 'installed'` and uses effective launch. Connection key remains `acp:<id>`.

## Key routes

| Method | Path | CLI | Notes |
| --- | --- | --- | --- |
| `GET` | `/acp/registry` | `acp registry list` | Remote registry |
| `GET` | `/acp/agents` | `acp agent list` | Inventory (local + registry) |
| `POST` | `/acp/agents` | `acp agent create` | Register local agent |
| `GET` | `/acp/agents/:agentId` | `acp agent get` | One row |
| `PATCH` | `/acp/agents/:agentId/launch-config` | `acp agent launch-config` | Local base or registry overrides |
| `PUT` | `/acp/agents/:agentId/installation` | `acp agent install` | Registry only; preserves `override_*` unless distribution type changes |
| `DELETE` | `/acp/agents/:agentId/installation` | `acp agent cancel-install` | Cancel in-flight install (not uninstall) |
| `DELETE` | `/acp/agents/:agentId` | `acp agent uninstall` | Remove row; FS cleanup only for registry binary |

## Reinstall vs overrides

`saveInstalledToDb` / `markInstalling` update base install fields only and never write `override_*` or flip `source` on conflict updates. If reinstall changes `distributionType`, all overrides are cleared and audit `launch_override_cleared` is recorded when prior overrides existed.

## Files

- **index.ts**: HTTP endpoints and Download Center dependency wiring.
- **service.ts**: capability semantics (local register, launch-config, install/uninstall, audit).
- **launch-config.ts**: pure merge + binary path safety helpers.
- **acp.registry.ts**: remote registry fetch and package distribution helpers.
- **acp.installer.ts**: package-install resolution plus binary archive extraction and installation after Download Center transfer.
- **model.ts**: TypeBox request/response models.
