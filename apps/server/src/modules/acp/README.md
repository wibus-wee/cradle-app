# ACP Module

HTTP-first ACP management capability for registry browsing, package-distribution installation resources, installed-agent inventory (registry + local + remote), launch and endpoint configuration, authentication selection, draft-session model discovery, and audit queries.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

Binary distributions are available whenever the official registry supplies a target for the current platform. The server Download Center owns transfer, byte limits, optional checksum verification, retry, and artifact cleanup; ACP owns archive extraction and installation. Registry checksums are used when supplied but are not required for binary installation.

## Source model

| `source` | Base launch (`cmd` / `args` / `env` / `distribution_type`) | Overrides (`override_*`) | Install via `PUT …/installation` |
| --- | --- | --- | --- |
| `registry` | Owned by installer on install/reinstall | User via `PATCH …/launch-config` | Allowed |
| `local` | Owned by user on create/PATCH | Always null | **409** `acp_local_not_installable` |
| `remote` | HTTPS/WSS endpoint plus Header-to-Secret references | Not applicable | **409** `acp_local_not_installable` |

`distribution_type` application values: `binary` | `npx` | `uvx` | `command` | `remote`.

- `command`: direct `spawn(cmd, args)` (local absolute binaries or PATH names).
- `binary`: resolve under `installPath` (absolute `cmd` allowed; relative must stay under install root).
- `npx` / `uvx`: package wrappers (unchanged).
- `remote`: no process launch; `connection_type` selects HTTP or WebSocket and `endpoint_url` owns the protocol endpoint.

Remote endpoints require `https:` or `wss:`. Plain `http:` and `ws:` are accepted only for loopback hosts. Request-header values are never stored in ACP rows: `remote_headers_secret_refs_json` maps validated, non-transport-owned header names to existing Secrets IDs. Audit records include only endpoint origins and header names.

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
| `GET` | `/acp/agents` | `acp agent list` | Inventory (local + remote + registry) |
| `POST` | `/acp/agents` | `acp agent create` | Register local agent |
| `POST` | `/acp/agents/remote` | `acp agent create-remote` | Register an HTTP/WebSocket endpoint with Secrets references |
| `GET` | `/acp/agents/:agentId` | `acp agent get` | One row |
| `GET` | `/acp/agents/:agentId/auth-methods` | `acp agent auth-methods` | Initialize without ACP credential values and return live advertised methods. |
| `PUT` | `/acp/agents/:agentId/auth` | `acp agent auth-set` | Persist a supported agent-managed method ID, then reconnect and authenticate. |
| `DELETE` | `/acp/agents/:agentId/auth` | `acp agent auth-clear` | Clear the selection and disconnect the current process. |
| `PATCH` | `/acp/agents/:agentId/launch-config` | `acp agent launch-config` | Local base or registry overrides; disconnects the current process |
| `PATCH` | `/acp/agents/:agentId/remote-config` | `acp agent remote-config` | Update a remote endpoint and reconnect on next use |
| `PUT` | `/acp/agents/:agentId/installation` | `acp agent install` | Registry only; preserves `override_*` unless distribution type changes |
| `DELETE` | `/acp/agents/:agentId/installation` | `acp agent cancel-install` | Cancel in-flight install (not uninstall) |
| `DELETE` | `/acp/agents/:agentId` | `acp agent uninstall` | Disconnect, remove row; FS cleanup only for registry binary |

## Reinstall vs overrides

`saveInstalledToDb` / `markInstalling` update base install fields only and never write `override_*` or flip `source` on conflict updates. If reinstall changes `distributionType`, all overrides are cleared and audit `launch_override_cleared` is recorded when prior overrides existed.

Auth selection is also preserved across registry reinstall. Stable ACP authentication methods are agent-managed or terminal-based, so ACP rows persist only `auth_method_id`. Cradle supports agent-managed methods through the runtime connection; terminal methods are returned as unsupported because Cradle does not host an interactive terminal authentication flow. Legacy environment-variable credential mappings are cleared when a selection changes. Remote transport headers remain separate connection configuration and continue to reference values owned by the Secrets module.

## Files

- **index.ts**: HTTP endpoints and Download Center dependency wiring.
- **service.ts**: capability semantics (local/remote register, launch/endpoint config, auth selection, install/uninstall, audit).
- **launch-config.ts**: pure merge + binary path safety helpers.
- **acp.registry.ts**: remote registry fetch and package distribution helpers.
- **acp.installer.ts**: package-install resolution plus binary archive extraction and installation after Download Center transfer.
- **model.ts**: TypeBox request/response models.
