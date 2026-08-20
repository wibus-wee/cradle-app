# Plan 075: Add per-Provider extensions and make CPA the first protocol converter

> **Executor instructions**: Read this entire plan before changing code. This is a
> coordinated two-repository change: the Host and public SDK live in
> `/Users/wibus/dev/cradle-app`; the first extension implementation lives in
> `/Users/wibus/dev/cradle-plugins`. Follow the steps in order, run every stated
> verification, and confirm the expected result before continuing. Do not create
> a compatibility shim or a second Provider row. If a STOP condition occurs,
> stop and report it instead of improvising. When both repositories are complete,
> update this plan's row in `plans/README.md` unless a reviewer owns the index.
>
> **Drift checks (run first)**:
>
> ```bash
> cd /Users/wibus/dev/cradle-app
> git diff --stat d40f895e..HEAD -- \
>   packages/plugin-sdk packages/db apps/server/src/plugins \
>   apps/server/src/modules/provider-targets \
>   apps/server/src/modules/external-provider-sources \
>   apps/server/src/modules/chat-runtime \
>   apps/web/src/features/agent-runtime \
>   apps/web/src/features/agent-management \
>   apps/web/src/features/composer-toolbar
>
> cd /Users/wibus/dev/cradle-plugins
> git diff --stat 04942ba..HEAD -- plugins/cli-proxy-api package.json pnpm-lock.yaml
> ```
>
> If an in-scope file changed, compare the live symbols with the excerpts in
> "Current state". Stop on a semantic mismatch, a conflicting migration number,
> or active work on Plan 073's Provider files; do not merge the designs by guess.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: none; coordinate with Plan 073 if it is active
- **Category**: direction / migration / tech-debt
- **Planned at**: `cradle-app` commit `d40f895e` and `cradle-plugins` commit `04942ba`, 2026-08-12
- **Revised**: 2026-08-12 — added no-login Codex OAuth through an exclusive,
  two-phase credential lease; manual CPA login remains removed
- **Implementation status (2026-08-13)**: API-key Provider Extension path
  implemented and verified. Codex OAuth remains release-blocked at M0: the
  pinned `7.2.130` binary proved prefix/model discovery and both protocol entry
  paths, and the lossless codec/lease is implemented, but no authorized real
  refresh credential was available to prove refresh-time prefix/account
  isolation. OAuth applicability is therefore disabled with an explicit reason.

## Why this matters

Cradle currently models a plugin-provided proxy as another external Provider.
That duplicates identity, makes the user refresh/import a synthetic target, and
cannot express the desired product: enable a named extension on one existing
Provider and let otherwise-incompatible runtimes use that same Provider. It also
turns plugin activation into an implicit global routing decision.

This plan adds a generic, per-Provider `Provider Extension` contract. The Host
owns binding intent, conflict policy, credentials, and runtime selection; a
plugin owns its converter process and its configuration. CLIProxyAPI (called CPA
below) becomes the first implementation. An API-key-backed OpenAI-compatible
Provider is borrowed by CPA only for converted traffic. A Cradle-owned Codex
OAuth Provider uses an exclusive, reversible credential lease so CPA can become
the sole token refresh owner while the extension is enabled. Neither flow asks
for a second CPA login or creates another Provider.

## Product decisions and non-negotiable invariants

These are settled requirements, not options for the executor:

1. **A Provider keeps one identity.** Enabling an extension never inserts into
   `provider_targets`, never changes its id/name/source/model settings, and never
   projects a second Provider from a plugin source.
2. **Bindings are per Provider.** Enabling a plugin does not enable it for every
   Provider. The Provider detail surface lists applicable extensions by their
   human label, for example `通过 CLIProxyAPI 扩展`, with one Enable/Disable
   control per extension.
3. **The user does not choose a conversion direction.** The plugin declares its
   fixed routes. CPA v1 declares OpenAI-compatible native passthrough plus
   Anthropic conversion. A borrowed API key uses passthrough directly and CPA
   only for conversion; an exclusive Codex OAuth lease routes both through CPA.
   One toggle enables or disables that contribution as a unit.
4. **Toggle mutations have awaited callbacks.** `onEnable`, `onDisable`, and
   `onReconcile` are authoritative lifecycle operations. A fire-and-forget event
   listener is not sufficient. Post-commit lifecycle events are notifications,
   not a second authority.
5. **Native routing wins for borrowed static credentials.** If a runtime already
   accepts an API-key Provider's native kind, use it directly. A refreshable
   OAuth credential is different: while its exclusive lease belongs to the
   extension, all routes for that Provider go through the extension so Cradle
   and CPA can never concurrently use or refresh the account.
6. **No hidden priority.** Two enabled extensions on the same Provider may not
   add the same output Provider kind. Reject the second Enable with HTTP 409.
   Different non-overlapping output kinds may coexist. Extension chaining is not
   supported in v1.
7. **Secrets always have one active owner.** Cradle decrypts a source credential
   only inside an awaited lifecycle/lease call and only for a plugin that
   declared and was granted `provider.credentials.use`. API keys remain
   Host-owned borrowed secrets. Codex OAuth is Host-owned while disabled and
   CPA-owned while enabled; ownership changes through a crash-recoverable
   two-phase lease, never by activating two copies. Applicability/list/status/
   runtime metadata never contains raw credentials. CPA writes generated config
   and managed auth files as mode `0600`; Host encrypts returned OAuth state and
   CPA's data-plane key in `agent_credentials`.
8. **An active run is route-frozen.** Enable/Disable invalidates idle provider
   runtime sessions, but never rewrites an active run in place. A later runtime
   session observes the new route.
9. **Plugin Disable is suspension; uninstall is removal.** Disable cleans live
   plugin state but preserves `desiredEnabled=true`, reports the binding as
   unavailable, and reconciles it after reactivation. Confirmed uninstall calls
   cleanup and then deletes that plugin's bindings and Host-owned output
   credentials.
10. **Codex OAuth uses an exclusive lease, not a second login.** Enabling a
    `chatgpt-auth` Provider stages its existing credential into a binding-owned
    CPA auth file, commits CPA as the sole owner, then starts routing. Disabling
    first stops routing, returns the latest refreshed state to Cradle, commits
    Host ownership, and only then removes CPA's file. CPA's Accounts/login UI and
    `/auth/:provider` route are removed. Existing unrelated CPA account files are
    moved out of the configured managed auth directory and preserved as inert
    legacy data; they must never enter routing implicitly.

## Terminology and ownership

| Term | Owner | Meaning |
| --- | --- | --- |
| Provider target | `provider-targets` | The existing durable Provider identity and source configuration. |
| Extension contribution | Plugin SDK + plugin registry | A plugin's declaration that it can add one or more protocol kinds to an eligible Provider. |
| Extension binding | `provider-extensions` | Durable per-Provider desired state, observed state, activation metadata, output credential ref, and source fingerprint. |
| Activation metadata | Plugin, persisted by Host | Non-secret JSON returned by Enable/Reconcile, such as CPA entry name, prefix, and endpoint. |
| Credential lease | `provider-extensions` | Durable exclusive ownership state for a refreshable credential. It records owner/epoch/transition only, never token material. |
| Runtime projection | Host routing + plugin `resolveRuntime` | Ephemeral provider kind/config/model-id projection. It is not a Provider row. |
| Public model id | Provider target | The model id stored/selected in Cradle UI and sessions. |
| Effective model id | Extension runtime projection | The converter-specific id sent to the runtime, e.g. `<binding-prefix>/<public-model-id>`. |

## Current state

### Host and SDK (`/Users/wibus/dev/cradle-app`)

- `packages/plugin-sdk/src/server.ts:317-320` exposes only external Provider
  sources under the Provider namespace:

  ```ts
  export interface ServerPluginProviderRegistries {
    /** External provider sources that return host-rendered provider snapshots */
    externalSources: ExternalProviderSourceRegistry
  }
  ```

- `packages/plugin-sdk/src/server.ts:757-811` lets such a source return complete
  Provider records, including a raw credential in a host callback. There is no
  per-target extension or awaited Enable/Disable contract.
- `apps/server/src/plugins/context.ts:182-188` only wires
  `ctx.providers.externalSources.register(...)`.
- `apps/server/src/modules/provider-targets/service.ts:292-315` filters stored
  targets only by their durable `providerKind`:

  ```ts
  return [
    ...rows.filter(row => runtimeSupportsProviderKind(runtimeKind, row.providerKind)),
    ...runtimeOwnedTargets,
  ]
  ```

- `apps/server/src/modules/provider-targets/service.ts:339-373` has a special
  built-in `universal` projection, while
  `apps/server/src/modules/provider-targets/service.ts:546-596` uses that result
  for compatibility checks. There is no generic extension route.
- `apps/server/src/modules/chat-runtime/runtime-session-context.ts:166-187`
  builds the effective runtime profile from the resolved target and uses the
  target's credential ref. `run/run-coordinator.ts` resolves the requested model
  later, so protocol conversion must project both the profile and the effective
  model id through one route decision.
- `packages/db/src/schema/provider-target.ts:14-54` stores the Provider identity;
  no extension state exists. `apps/server/src/modules/secrets/service.ts:258-339`
  already supplies encrypted credential upsert/remove APIs; reuse it rather than
  adding plugin secret columns.
- `apps/server/src/plugins/loader.ts:330-359` disposes plugin registrations before
  calling plugin `deactivate`. Provider-extension suspension must run while its
  callbacks are still registered.
- `apps/web/src/features/composer-toolbar/composer-profile-selection.ts:24-42`
  performs kind-only client filtering. `apps/web/src/features/agent-runtime/use-provider-targets.ts:13-41`
  does not carry effective kinds, so a server-only change would still hide an
  extended Provider in several UI selectors.
- `apps/web/src/features/agent-management/profile-detail-panel.tsx` and
  `external-provider-record-detail-panel.tsx` are current manual/external detail
  surfaces. They are dependency-owning components, not fixture-driven Views;
  any new visible extension surface must follow the repository's `*View`/
  Container seam rule rather than adding more data access to these files.

### CPA plugin (`/Users/wibus/dev/cradle-plugins`)

- `plugins/cli-proxy-api/src/server.ts:97-162` registers one aggregate external
  Provider named CLIProxyAPI with `providerKind: 'universal'`. That projection is
  the behavior this plan deletes.
- `plugins/cli-proxy-api/src/server.ts:192-194` autostarts the sidecar merely
  because the binary is installed. Extension activation should instead start it
  only when at least one desired binding is reconciled, while the explicit
  Start/Stop diagnostics controls may remain.
- `plugins/cli-proxy-api/src/sidecar.ts:53-74` renders only listener/auth keys;
  `writeConfig` writes mode `0600`. Extend this renderer with binding-owned
  `openai-compatibility` entries without weakening the file mode.
- `plugins/cli-proxy-api/src/server.ts:70-88`, `sidecar.ts:38-47`, and
  `web.tsx:26-85,211-239` implement CPA-owned OAuth login and Accounts UI. Remove
  these public affordances in this plan; do not delete legacy account files.
- `plugins/cli-proxy-api/README.md` describes the aggregate external Provider and
  OAuth flow and must be rewritten around per-Provider extension bindings.
- CPA's current official configuration documents `openai-compatibility` entries
  with `name`, `prefix`, `base-url`, `api-key-entries`, and explicit `models`
  mappings. It also documents prefixed routing as `prefix/model`. Reconfirm these
  fields against the pinned managed runtime before implementation:
  <https://help.router-for.me/configuration/basic#example-configuration>.
- CPA officially supports Codex OAuth account files under `auth-dir`, and its
  management API can upload, download, disable, and delete an individual auth
  file. The pinned binary must additionally prove that binding-specific
  `prefix/model` routing survives refresh before the OAuth lease is enabled:
  <https://help.router-for.me/configuration/provider/codex> and
  <https://help.router-for.me/cn/management/api#认证文件管理>.

## Target SDK contract

Add the following semantics to `@cradleapp/plugin-sdk/server`. Match existing SDK
style and exported JSON types rather than copying this pseudocode verbatim if an
equivalent owner type already exists:

```ts
interface ProviderExtension {
  id: string
  label: string
  description?: string
  conversions: Array<{
    fromProviderKind: 'openai-compatible' | 'anthropic' | 'universal'
    addedProviderKinds: Array<'openai-compatible' | 'anthropic' | 'universal'>
  }>

  // Synchronous and secret-free; safe for list/detail projection.
  getApplicability(input: ProviderExtensionTargetDescriptor):
    | { applicable: true }
    | { applicable: false, reason: string }

  // Awaited, serialized per binding, and allowed to receive the source secret.
  onEnable(ctx: ProviderExtensionEnableContext): Promise<ProviderExtensionActivation>
  onDisable(ctx: ProviderExtensionDisableContext): Promise<ProviderExtensionDisableResult>
  onReconcile(ctx: ProviderExtensionReconcileContext): Promise<ProviderExtensionActivation>

  // Optional, required for a refreshable credential that the extension must own.
  credentialLease?: ProviderExtensionExclusiveCredentialLease

  // Synchronous, side-effect-free, and secret-free. It consumes persisted
  // non-secret activation metadata and produces an ephemeral runtime route.
  resolveRuntime(ctx: ProviderExtensionResolveContext): ProviderExtensionRuntimeProjection
}
```

Contract requirements:

- `ProviderExtensionTargetDescriptor` contains target id/kind/provider kind,
  safe connection/config fields needed by a converter, source credential kind
  (not value), and configured public model ids. Use an owning SDK type; do not
  pass a Drizzle row or an ad-hoc `unknown` object.
- Enable/Reconcile source credential input is `{ kind, value } | null` and exists
  only during the callback. Do not put it in activation metadata, errors, logs,
  events, route responses, or `connectionConfigJson`.
- `ProviderExtensionActivation` contains declared output kinds, non-secret JSON
  state, and optionally one output data-plane credential `{ kind, label, value }`.
  Host validates output kinds against `conversions`, encrypts the output value,
  and persists only its credential ref.
- Applicability declares a credential strategy selected by credential kind, not
  by another UI choice: `borrowed-static` for API keys or
  `exclusive-refreshable` for Codex OAuth. A plugin may reject other refreshable
  kinds with a safe reason.
- `ProviderExtensionExclusiveCredentialLease` has four awaited callbacks:
  `prepareAcquire`, `commitAcquire`, `prepareRelease`, and `commitRelease`.
  Prepare Acquire stages a disabled binding-owned credential without starting
  CPA; Commit Acquire makes it usable only after Host persists extension
  ownership. Prepare Release stops/disables use, returns the latest credential
  while retaining a recoverable copy; Commit Release deletes that copy only
  after Host has encrypted and committed the returned state. Every callback is
  idempotent by `(bindingId, leaseEpoch)`.
- The Host validates a returned OAuth credential against the existing owning
  credential contract before overwriting the same `credentialRef`. It never
  invents a frontend projection or stores a token in activation JSON.
- `onDisable` receives a typed reason:
  `user-disabled | provider-disabled | provider-deleted | plugin-disabled |
  plugin-uninstalled | permission-revoked`.
- `ProviderExtensionRuntimeProjection` may change `providerKind`, apply a safe
  config patch/base URL, and return `effectiveModelId`. It may not change target
  id, name, source identity, enabled/custom model settings, or expose a secret.
- Registration is `ctx.providers.extensions.register(extension)` and produces the
  same tracked `Disposable` shape as other registries. Its manifest capability
  type is `provider-extension`; a converter that reads source credentials must
  declare `provider.credentials.use` on the capability and in permissions.

## Binding state machine and callback ordering

Create one durable row per `(providerTargetId, extensionOwner, extensionId)`.
Use Drizzle and a generated migration. The table owns:

- `desired_enabled` boolean;
- observed `status`: `disabled | enabling | enabled | disabling | suspended | error`;
- `activation_json`, which must validate as non-secret JSON at every read;
- `output_credential_ref`, nullable FK to `agent_credentials`;
- `source_fingerprint` computed from safe target config, credential metadata
  including `updatedAt` (never secret text), and public model settings for a
  Host-owned borrowed credential. While an exclusive lease is extension-owned,
  CPA refreshes must not compare against or overwrite that stale Host snapshot;
  readiness uses lease epoch plus the plugin's managed-file status instead;
- sanitized `last_error`, plus timestamps;
- `credential_strategy`, `credential_owner` (`host | extension`), monotonically
  increasing `lease_epoch`, and transition/finalize state sufficient to recover
  a crash between either prepare/commit pair. These columns contain no auth
  payload, filenames supplied by an account, or token fingerprint;
- a unique index on target/owner/extension and a cascade FK from binding to the
  Provider target. Cleanup callbacks must run before relying on the FK cascade.

Serialize transitions per binding with the existing single-flight/registry
pattern; do not add an in-process check-then-act race. The algorithms are:

### Enable

1. Resolve the existing, enabled target. Confirm applicability, permission grant,
   runtime resource readiness, at least one configured public model for CPA, and
   no enabled binding whose output kinds overlap.
2. Persist `desired=true,status=enabling` before the callback and invalidate idle
   runtime sessions. For an exclusive OAuth lease, reject Enable with 409 while
   an active run still owns the Host credential; do not cancel it implicitly.
3. For `borrowed-static`, decrypt the source credential and proceed to
   `onEnable`. For `exclusive-refreshable`, allocate a new lease epoch, await
   `prepareAcquire` (which must stage but not activate the auth file), then
   commit `credential_owner=extension` before awaiting `commitAcquire` and
   `onEnable`. After that commit, no native route may use the Host snapshot.
4. Validate activation output. Upsert a stable system credential id derived from
   binding id, persist non-secret activation/fingerprint/ref, then set `enabled`.
5. Invalidate idle runtime sessions for the target; leave active runs frozen.
6. Publish a sanitized `ProviderExtensionLifecycleEvent` only after the committed
   state is visible.
7. On borrowed-secret failure, call best-effort compensating `onDisable`, delete
   newly written output state, persist error, and publish `failed`. On exclusive
   lease failure after ownership commit, execute the same two-phase credential
   return used by Disable before reporting failure. Never silently flip ownership
   to Host while CPA may still refresh the staged account.

### User Disable

1. Persist `desired=false,status=disabling`; routing stops immediately.
2. If an OAuth-backed active run exists, return 409 and leave the binding
   enabled; do not pull a credential out from under a run. Otherwise await
   `onDisable(reason='user-disabled')` so CPA stops and disables the managed auth
   before ownership changes.
3. For an exclusive lease, await `prepareRelease`, validate the returned Codex
   OAuth state, encrypt/upsert it into the Provider's existing credential ref,
   and atomically commit `credential_owner=host`. Then await `commitRelease` to
   delete the disabled CPA file. A crash before Host commit leaves CPA owner and
   retries Prepare Release; a crash after Host commit leaves a disabled cleanup
   file and retries Commit Release, never a second active owner.
4. Remove activation metadata and the output credential, persist `disabled`,
   invalidate idle runtime sessions, then publish `disabled`.
5. If cleanup fails, routing remains off; persist `error` with
   `desired=false`. Retrying Disable retries cleanup. Never reactivate to hide a
   cleanup failure.

### Suspension, reconcile, and removal

- Provider or plugin disable calls `onDisable` while the callback is registered,
  cleans live routing state, keeps `desired=true`, and records `suspended`.
  A suspended OAuth binding retains `credential_owner=extension` and its disabled
  managed auth file; the Provider is unavailable until reactivation reconciles
  it. Permission revocation must be ordered as an uninstall-style release back
  to Host before access is removed; abort revocation if return fails.
- Plugin Disable, permission revoke, uninstall, and extension Disable return 409
  while an active run uses an exclusive lease. Do not cancel or migrate an
  active run implicitly. A crashed CPA-backed run may be terminalized through
  the existing runtime owner before retrying the lifecycle operation.
- Provider deletion awaits cleanup before deleting the Provider. A successful
  prior suspension has no remaining plugin state and may delete directly. An
  unresolved cleanup error blocks deletion with 409 instead of orphaning a
  source secret in plugin-owned config.
- Confirmed plugin uninstall awaits `onDisable(reason='plugin-uninstalled')` for
  every binding, returns every exclusive credential lease to Host, removes output
  credentials/binding rows, then proceeds to plugin uninstall cleanup. Failure
  aborts uninstall so it can be retried.
- `ensureProviderExtensionReady` compares the source fingerprint before opening
  a new provider runtime session. If stale, it awaits `onReconcile`; therefore a
  direct credential-value update cannot silently leave CPA with an old key.
  Provider-target and external-source mutation paths should also request eager
  reconcile after their own commit for prompt UI feedback.
- Plugin registration at boot reconciles all `desired=true` bindings for that
  owner. An unavailable plugin never becomes a routable extension merely because
  an old activation blob exists.

Internal lifecycle notifications must include binding identity, previous/new
status and reason/error code only. Expose a typed subscription API for Host
observers/tests; do not make plugins subscribe to their own authoritative
callbacks and do not add a persisted event log in this plan.

## Runtime selection and model mapping

Replace kind-only compatibility with one Host-owned route selection function.
For `(target, runtimeKind, publicModelId?)`, select in this exact order:

1. runtime-owned/none binding behavior (unchanged);
2. an active extension that exclusively owns the target's refreshable credential;
   it must resolve both the target's native protocol and converted protocols;
3. direct native target kind if accepted by the runtime;
4. existing built-in `universal` endpoint projection;
5. exactly one borrowed-secret extension binding whose added kind is accepted;
6. otherwise return the existing incompatibility error.

The selected result must carry the unchanged Provider target identity, effective
provider kind, effective profile config, output credential ref when extended,
extension binding identity when used, and effective model id. All compatibility
assertions, Provider list filtering, runtime-session creation, title/side-chat/
capability paths that use the common runtime input, and Web selection must consume
this owner result instead of reimplementing kind checks.

For CPA, generate a stable non-secret prefix from the binding id. API-key targets
render one `openai-compatibility` entry with that prefix and exact model aliases.
Codex OAuth targets stage one binding-owned auth file with the same prefix and
enable `force-model-prefix`; the M0 gate below must prove that CPA routes exactly
that account rather than its global round-robin pool and preserves the prefix
after token refresh. `resolveRuntime` returns:

- effective kind requested by the runtime (`openai-compatible` or `anthropic`)
  for an exclusive OAuth lease; `anthropic` only for borrowed API-key conversion;
- CPA's loopback Anthropic base URL and no upstream secret;
- the Host-owned output data-plane credential ref;
- effective model `<prefix>/<publicModelId>`.

Do not store the prefixed id as the user's session/model preference. This avoids
collisions when two Providers expose the same public model id while preserving
the Provider's visible model inventory.

## HTTP and UI contract

Add a Server-owned `provider-extensions` Elysia module with TypeBox schemas,
OpenAPI detail, `x-cradle-cli` metadata, and a module README:

- `GET /provider-targets/:providerTargetId/extensions` returns registered and
  remembered extensions with `owner`, `id`, `label`, `description`, declared
  added kinds, `applicable`, inapplicability reason, `desiredEnabled`, `status`,
  availability, safe credential strategy/owner state, and sanitized error. It
  never returns activation JSON,
  credential refs, source config, or secret data.
- `PUT /provider-targets/:providerTargetId/extensions` accepts exactly
  `{ owner, id, enabled }`. The UI is not offered a direction or output-kind
  selector. Return the updated row after the awaited lifecycle transition.
- Extend the Provider target API owner response with `effectiveProviderKinds`,
  containing only kinds that are currently routable. A Host-owned target includes
  its durable native kind; an extension-owned OAuth target includes its native
  kind only when that extension can route it, and may expose an empty list while
  suspended/unavailable. Durable `providerKind` remains unchanged alongside this
  owner contract; this is not a frontend-only projection.

Create a domain feature seam:

- `apps/web/src/features/agent-management/provider-extensions/provider-extensions-view.tsx`
  exports the typed, fixture-renderable View with rows and callbacks only;
- a sibling Container/gateway owns generated queries/mutations, error mapping,
  and invalidation;
- fixtures and Storybook stories cover applicable disabled, enabling, enabled,
  suspended/unavailable, error/retry, and inapplicable states;
- manual and external Provider detail containers mount this same feature only
  when a durable target id exists.

Use existing design-system primitives, static Tailwind classes, and `cn()`.
Labels should read `通过 {extension.label} 扩展`; the only action is Enable or
Disable. Do not put CPA-specific copy, direction choice, or a global "apply to
all Providers" control in the Host UI.

## Commands you will need

Run only focused tests; repository instructions prohibit a full suite unless a
focused failure cannot be isolated.

### `cradle-app`

| Purpose | Command | Expected on success |
| --- | --- | --- |
| SDK build | `pnpm --filter @cradle/plugin-sdk build` | exit 0 |
| DB migration | `pnpm --filter @cradle/db generate` | one new reviewed Drizzle migration + metadata, exit 0 |
| Server types/boundaries | `pnpm typecheck:server` | exit 0, no errors |
| Web types | `pnpm typecheck:apps-web` | exit 0, no errors |
| API generation | `pnpm generate:web` | exit 0; generated client reflects extension routes and effective kinds |
| Server focused tests | `pnpm --filter @cradle/server exec vitest run src/plugins/provider-extension-registry.test.ts src/modules/provider-extensions src/modules/provider-targets/service.test.ts src/modules/chat-runtime/runtime-session-context.test.ts --maxWorkers=1` | all selected tests pass |
| Web focused tests | `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/agent-management/provider-extensions src/features/composer-toolbar/composer-profile-selection.test.ts` | all selected tests pass |
| Changed-file lint | `pnpm exec eslint <changed .ts/.tsx files>` | exit 0, no new findings |
| Integrity | `git diff --check` | no output |

### `cradle-plugins`

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm --filter @cradleapp/cli-proxy-api typecheck` | exit 0 |
| Tests | `pnpm --filter @cradleapp/cli-proxy-api test` | all tests pass |
| Build | `pnpm --filter @cradleapp/cli-proxy-api build` | exit 0 |
| Integrity | `git diff --check` | no output |

## Suggested executor toolkit

- Use `server-app-development` for the Elysia module, TypeBox/OpenAPI contract,
  README, and generated client workflow.
- Use `provider-runtime-integration` when changing target-scoped runtime
  resolution and lifecycle invalidation.
- Use `make-interfaces-feel-better` for the Provider detail View states; preserve
  the repository's fixture-driven seam and do not add decorative motion.
- Use `clear-docs-comments` when rewriting the SDK/Server/CPA documentation.
- Use the official CPA configuration reference linked above and the exact pinned
  managed runtime version. Do not infer YAML keys from memory.

## Scope

### In scope: `cradle-app`

- `packages/plugin-sdk/src/server.ts`, manifest/permission exports and their
  focused contract tests/docs.
- `packages/db/src/schema/provider-extension.ts` (new), schema barrel, one
  generated Drizzle migration and migration metadata.
- `apps/server/src/plugins/provider-extension-registry.ts` and test (new),
  `context.ts`, `loader.ts`, plugin capability/manifest boundary tests, and
  plugin developer docs.
- `apps/server/src/modules/provider-extensions/` (new owner module: model,
  service, public API, Elysia routes, README, focused tests).
- `apps/server/src/modules/provider-targets/` and
  `apps/server/src/modules/external-provider-sources/` only where needed to
  invoke lifecycle/reconcile and expose owner projections.
- `apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts`
  and its test, plus `apps/server/src/modules/secrets/service.ts` and its test,
  only where required to validate a lossless CPA lease handoff and enforce the
  owner guard. Do not redesign login or add a second OAuth credential type. A
  leased Provider credential cannot be updated, removed, revealed to a runtime,
  or refreshed through a Host path while CPA owns it; encryption-key rotation of
  the inactive escrow value remains allowed.
- `apps/server/src/modules/chat-runtime/runtime-session-context.ts`, the common
  run-resolution seam, and focused tests required to carry effective model id
  and freeze active routes.
- `apps/server/src/app.ts` composition for the new module.
- generated Web API files changed by `pnpm generate:web`.
- `apps/web/src/features/agent-runtime/`,
  `apps/web/src/features/composer-toolbar/`, and
  `apps/web/src/features/agent-management/provider-extensions/`, plus minimal
  mounting changes in the two Provider detail surfaces and their stories/tests.
- Provider/plugin/runtime README or developer documentation directly describing
  these public contracts.

### In scope: `cradle-plugins`

- `plugins/cli-proxy-api/src/server.ts`, `sidecar.ts`, `runtime.ts`, `web.tsx`,
  a typed binding-owned Codex auth-file adapter, their focused tests,
  manifest/package metadata, and README.
- Workspace catalog/lockfile changes strictly required to consume the released
  SDK contract.

### Out of scope

- Creating, mirroring, importing, or refreshing a CPA Provider target.
- A global extension toggle, per-conversion selector, extension priority UI,
  extension chaining, fallback chains, load balancing, or automatic enablement.
- A new CPA OAuth login, account picker, global account pool, or migration of
  Claude/Gemini/other OAuth formats. Plan 075 supports only a lossless exclusive
  lease of an already authenticated Cradle Codex OAuth Provider. Preserve
  unrelated legacy CPA account files outside the managed auth directory and do
  not expose or auto-import them.
- A new secret store, plaintext secret columns, or DB event log.
- Modifying provider-specific native runtime protocols beyond the common
  resolved profile/model-id seam.
- Browser/E2E tests. Use View fixtures/stories and focused service/integration
  tests.
- Finishing or redesigning Plan 073. If it is active on overlapping Provider
  identity/API/UI files, stop and coordinate/rebase.

## Git and release workflow

This change crosses a published SDK boundary. Do not make the CPA repository
compile by copying private Host types or by adding a temporary duplicate API.

1. In `cradle-app`, use branch `advisor/075-provider-extensions-host`. Land the
   SDK/Host contract, tests, docs, migration, and Web surface as logical commits.
   Existing history uses conventional prefixes; use messages such as
   `feat(plugin-sdk): add provider extension lifecycle` and
   `feat(providers): route targets through enabled extensions`.
2. Publish the required `@cradleapp/plugin-sdk` version through the repository's
   normal SDK release workflow only after Host verification. Do not run publish
   unless the operator explicitly authorizes it.
3. In `cradle-plugins`, use branch `advisor/075-cli-proxy-provider-extension`,
   update the catalog/lock to that SDK, then migrate CPA. If a local supported
   workspace link is used during development, remove it before final verification.
4. Do not push or open PRs unless the operator asks. If asked, follow each repo's
   PR template and keep Host/SDK and CPA as separate, cross-linked PRs; merge the
   Host/SDK release first.

## Steps

### Step 0: Prove Codex OAuth lease interoperability before designing around it

This is a mandatory feasibility gate and must run against the exact CPA managed
runtime version selected by `plugins/cli-proxy-api/src/runtime.ts`. Use synthetic
credential fixtures wherever possible; if a real refresh is required, use an
explicitly authorized disposable test account and never commit/log its values.

Prove all of the following:

1. Cradle's existing `chatgpt-auth` owner codec can be transformed into the CPA
   Codex auth-file schema and transformed back after CPA rewrites it without
   losing refresh token, access token, expiry, account identity, or fields the
   Cradle Codex runtime requires.
2. A binding-generated `prefix` selects exactly that OAuth auth file for both
   CPA's OpenAI/Responses-compatible and Anthropic-compatible request paths.
   Two auth files with the same public model and different prefixes must never
   round-robin or fail over across Provider bindings.
3. The prefix and account identity survive a CPA-performed refresh and can be
   exported through the supported auth-file management/file-store interface.
4. A disabled/staged auth file is neither selected nor refreshed before Commit
   Acquire, and a disabled release-pending file remains inert until deletion.
5. CPA can run with a dedicated managed auth directory containing only
   binding-owned files, while the old plugin auth directory remains inert.

Capture only schemas with placeholder values and wire assertions. If any item
fails, mark Plan 075 BLOCKED at M0. The API-key extension foundation may be kept
as a separately reviewable partial branch, but do not mark this plan complete
and do not fall back to CPA login, global OAuth pooling, filename heuristics, or
two refresh owners.

**Verify**:

```bash
cd /Users/wibus/dev/cradle-plugins
pnpm --filter @cradleapp/cli-proxy-api exec vitest run \
  src/codex-credential-lease.compatibility.test.ts
```

Expected: the pinned real-binary gate passes all five properties without
printing credential material. If the binary cannot be exercised in automation,
produce a version-pinned disposable manual gate and treat it as mandatory before
the OAuth implementation/release.

### Step 1: Add and verify the public Provider Extension SDK contract

Implement the target and exclusive credential-lease contracts above in
`packages/plugin-sdk`. Add the Provider
extension registry to `ServerPluginProviderRegistries`, manifest capability
validation, exported typed reason/state/projection shapes, and SDK contract
tests. Use existing JSON owner types and strict discriminated unions; do not use
`unknown` plus inline guards or expose Host Drizzle/runtime types.

Document which callbacks may receive/return a source credential, their idempotent
lease epoch, and that `resolveRuntime` must be synchronous, side-effect-free,
and secret-free.

**Verify**:

```bash
pnpm --filter @cradle/plugin-sdk build
pnpm --filter @cradle/plugin-sdk typecheck
```

Expected: both exit 0, and a type fixture can register an extension with all four
callbacks while an undeclared output kind or missing required field fails typecheck.

### Step 2: Add the Host registry, binding table, and lifecycle owner

Create the plugin registry by following the ownership/disposal pattern in
`external-provider-source-registry.ts`, including capability registration and
duplicate owner/id rejection. Then create `provider-extensions` as the sole owner
of binding persistence, lifecycle serialization, secret handoff, source
fingerprints, conflict checks, compensation, and post-commit events.

Generate one Drizzle migration. Review the SQL: it may create only the extension
binding table/indexes/FKs described above; it must not alter or duplicate
`provider_targets` and must not store a secret value.

Add unit/service tests for:

- duplicate registry ids and disposal;
- Enable success and each validation rejection;
- overlapping output kind conflict;
- callback failure compensation and sanitized errors;
- Disable cleanup/retry semantics;
- suspension preserving desired state;
- reconcile on stale fingerprint;
- two-phase exclusive lease acquire/release and every crash boundary;
- active-run 409 for OAuth Enable/Disable and exclusive route ownership;
- uninstall/permission revoke returning the latest credential to Host;
- lifecycle events firing after committed state only;
- no raw source/output secret in rows, response-shaped objects, logs, or events.

**Verify**:

```bash
pnpm --filter @cradle/db generate
pnpm --filter @cradle/server exec vitest run \
  src/plugins/provider-extension-registry.test.ts \
  src/modules/provider-extensions --maxWorkers=1
```

Expected: one reviewed migration and all selected tests pass.

### Step 3: Wire plugin activation/deactivation and destructive lifecycle ordering

Wire `ctx.providers.extensions.register` in `plugins/context.ts`. Before a plugin
registration is disposed, have `loader.ts` ask the provider-extension owner to
suspend that owner's bindings while callbacks still exist. Add the equivalent
pre-uninstall cleanup/removal hook. Preserve desired state on Disable; remove it
only after confirmed uninstall cleanup succeeds.

Make Provider delete and Provider enabled-state transitions await extension
cleanup/suspension before their existing DB mutation completes. Request eager
reconcile after manual target updates and external source refresh; callbacks must
run outside database transactions. Reuse the source-fingerprint readiness check
as the correctness fallback for credential-only updates.

Wire permission revoke/uninstall so an exclusive credential is returned before
the plugin loses execution or credential permission. Provider deletion cleans
and destroys its CPA lease file; plugin uninstall returns the latest credential
because the Provider survives. Keep these reasons distinct in tests.

**Verify**:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/plugins/context.test.ts src/plugins/loader.test.ts \
  src/modules/provider-targets/service.test.ts \
  src/modules/external-provider-sources --maxWorkers=1
```

Expected: selected tests pass, including callback-before-disposal, retryable
uninstall failure, Provider-delete cleanup, and desired binding restoration.

### Step 4: Replace kind-only routing with extension-aware route resolution

Make `provider-targets` call one extension-aware owner API instead of reading
plugin tables/registries directly. Avoid a module cycle: the extension core
accepts a typed resolved target descriptor from the caller; its public module
must not import `provider-targets/service.ts` back through a hidden path.

Return direct/universal/extension as a discriminated route result. Carry the
extension identity and effective model id internally. Before opening a new
provider runtime session, await readiness/reconcile, rebuild the route once, and
pass the effective profile and effective model id together. Keep public/session
model preferences unchanged. Invalidate idle target runtime sessions after a
route transition and prove active run inputs remain frozen.

Extend target list responses with `effectiveProviderKinds`; remove client-side
assumptions that only durable `providerKind` determines compatibility. Do not
remove the durable `providerKind`, because it remains the Provider's identity and
native route.

**Verify**:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/modules/provider-targets/service.test.ts \
  src/modules/chat-runtime/runtime-session-context.test.ts --maxWorkers=1
pnpm typecheck:server
```

Expected: tests prove native precedence, built-in universal precedence, one-hop
extension fallback, overlap rejection, unavailable extension incompatibility,
public/effective model separation, and frozen active runs; typecheck exits 0.

### Step 5: Add the extension API and fixture-driven Provider detail surface

Implement the two HTTP routes and schemas described above, register the module in
`app.ts`, add route tests and update its README. Run Web API generation only
after the OpenAPI tests/typecheck pass.

Build the `ProviderExtensionsView` and Container/gateway. The View owns local
interaction presentation only and imports no query, route, store, Electron, or
generated client. Mount it in manual and external detail surfaces. Update all
For an exclusive OAuth lease, bypass native direct routing while the binding is
enabled and reject new runs if the owner/transition state is ambiguous. Provider
status and diagnostics must explain `Credential leased to CLIProxyAPI` without
exposing account identity or token metadata.

Update Provider selection/filtering call sites found by:

```bash
rg -n "runtimeSupportsProviderKind\(|providerKinds.includes" \
  apps/web/src/features/agent-runtime \
  apps/web/src/features/agent-management \
  apps/web/src/features/composer-toolbar
```

Each affected call must consume the Host's effective kinds or a feature-owned
helper based on them; no caller may guess that enabling CPA changed the durable
kind.

**Verify**:

```bash
pnpm generate:web
pnpm typecheck:apps-web
pnpm --filter @cradle/web exec vitest run --config vite.config.ts \
  --environment jsdom \
  src/features/agent-management/provider-extensions \
  src/features/composer-toolbar/composer-profile-selection.test.ts
```

Expected: generation and typecheck exit 0; View fixtures and compatibility tests
pass; no visible surface mounts a data-owning Container in Storybook.

### Step 6: Convert CPA from aggregate Provider source to per-target extension

After the new SDK is available in `cradle-plugins`:

1. Delete `ctx.providers.externalSources.register` and the
   `external-provider-source.cli-proxy-api` manifest capability. There must be no
   CPA Provider record or Providers refresh step.
2. Register one extension labeled `CLIProxyAPI`, declaring
   the fixed OpenAI-compatible passthrough + Anthropic conversion outputs and the
   required credential permission. Applicability accepts either an API-key
   OpenAI-compatible target with base URL/models (`borrowed-static`) or an
   already-authenticated Codex `chatgpt-auth` target proven by Step 0
   (`exclusive-refreshable`). It rejects missing credentials/models, unsupported
   OAuth providers, and all other kinds with explicit safe reasons.
3. Refactor sidecar config ownership around a map of binding entries. Render
   deterministic `openai-compatibility` YAML entries with stable unique
   name/prefix, source base URL, source API key entry, and exact model mappings.
   Keep loopback listener/data-plane key controls and file mode `0600`.
4. `onEnable`/`onReconcile` atomically rewrite the complete generated config,
   start or hot-reload the sidecar, health-check it, and return non-secret
   activation metadata plus the data-plane key. `onDisable` removes only that
   binding's entry, atomically rewrites config, and stops CPA when no extension
   binding remains. A failed rewrite must leave the previous complete config
   recoverable; never partially truncate it.
5. Implement the Codex lease adapter from Step 0. Use a dedicated generated
   `managed-auth` directory and deterministic binding filename/prefix. Prepare
   Acquire writes it disabled; Commit Acquire enables it after Host ownership;
   Prepare Release disables CPA routing/refresh and returns the latest typed
   credential while retaining the file; Commit Release deletes it. Every action
   is idempotent by binding/epoch and verifies the exact file/auth id it owns.
6. `resolveRuntime` validates its activation metadata, returns the loopback
   Anthropic base URL, kind `anthropic`, and prefixed effective model id. It does
   no I/O and never reads the source credential. For an exclusive OAuth lease it
   also resolves the CPA OpenAI/Responses route so native Codex traffic does not
   bypass the sole credential owner.
7. Remove installed-binary autostart. Keep explicit Start/Stop/port diagnostics
   only if their states are honest when bindings own required operation.
8. Remove CPA OAuth *login* routes, CLI login flags/methods, transient login
   status, Accounts UI, and login manifest capability. Do not remove the new
   Host-driven auth-file lease adapter. Move/configure old account files outside
   `managed-auth`, preserve them as inert legacy data in uninstall inspection,
   and never auto-bind them.
9. Rewrite README/package descriptions around both no-login flows: borrowed API
   key and exclusive Codex OAuth lease.

Add tests for deterministic YAML/key ordering, escaping, duplicate public model
ids across separate bindings, stable prefixes, mode `0600`, atomic replacement,
per-binding removal, last-binding stop, callback compensation, credential
redaction, model prefix resolution, OAuth schema round-trip, two-account routing
isolation, refresh/export, every lease crash boundary, and managed-vs-legacy auth
directory isolation. Update runtime/status tests for removal of manual
OAuth/account UI fields.

**Verify**:

```bash
pnpm --filter @cradleapp/cli-proxy-api typecheck
pnpm --filter @cradleapp/cli-proxy-api test
pnpm --filter @cradleapp/cli-proxy-api build
```

Expected: all exit 0; grep below returns no matches in production CPA source or
manifest (test descriptions/migration notes may mention the removed behavior):

```bash
rg -n "externalSources\.register|/auth/:provider|-codex-login|-claude-login|title=\"Accounts\"" \
  plugins/cli-proxy-api/src plugins/cli-proxy-api/package.json
```

### Step 7: Prove the first end-to-end conversion without creating a Provider

Use a disposable test database, a fake loopback OpenAI-compatible upstream, and
the exact pinned CPA managed binary when available. Create one manual
OpenAI-compatible Provider with an API-key credential and explicit model. Record
the `provider_targets` count and target id, enable CPA through the Host API, then
assert:

- count and id are unchanged;
- the extension binding reaches `enabled`;
- target `effectiveProviderKinds` adds `anthropic` but durable `providerKind`
  remains `openai-compatible`;
- an OpenAI-native runtime resolves directly with the public model id;
- Claude resolves to CPA's Anthropic endpoint with the prefixed effective model
  and Host-owned output credential;
- disabling removes Claude compatibility and CPA upstream config while leaving
  the Provider and its source credential unchanged;
- no CPA account/login step was performed.

If the managed binary cannot run in CI, keep the Host+renderer integration
automated and add a documented, version-pinned manual acceptance script. Do not
mock a successful CPA wire translation and call it end-to-end.

**Verify**: run the focused Host and CPA commands from "Commands you will need".
Expected: all pass; the real-binary acceptance either passes or is explicitly
reported as the only manual release gate.

Repeat the same acceptance with an already-authenticated Codex OAuth Provider:

- no CPA login route/command is called;
- Enable returns 409 while a native active run exists;
- after Enable, `credential_owner=extension`, the Provider still appears once,
  and both Codex/OpenAI and Claude routes use the same binding prefix through CPA;
- a forced/observed refresh updates only CPA's managed auth file;
- Disable returns 409 while a CPA-backed run is active, then returns the newest
  credential to the same Host `credentialRef`, deletes the managed file, commits
  `credential_owner=host`, and restores native routing;
- crash recovery succeeds before/after each acquire/release commit without two
  active refresh owners or credential loss.

### Step 8: Final boundaries, docs, and release readiness

Update SDK developer docs, Server module READMEs, CPA README, and any capability
examples. State the ownership/invariants from this plan, especially no Provider
creation, per-target opt-in, no direction selector, no chaining, overlap 409,
and OAuth deferral.

Run changed-file lint in both repos where configured, both typechecks/builds,
all focused tests, and diff integrity. Inspect status to confirm no generated
runtime config, account file, credential, local link, build output, or unrelated
source change is staged.

**Verify**:

```bash
cd /Users/wibus/dev/cradle-app
pnpm --filter @cradle/plugin-sdk build
pnpm typecheck:server
pnpm typecheck:apps-web
git diff --check
git status --short

cd /Users/wibus/dev/cradle-plugins
pnpm --filter @cradleapp/cli-proxy-api typecheck
pnpm --filter @cradleapp/cli-proxy-api test
pnpm --filter @cradleapp/cli-proxy-api build
git diff --check
git status --short
```

Expected: verification exits 0; status contains only reviewed in-scope source,
tests, docs, generated API/migration metadata, and intentional lock/catalog
changes.

## Test plan

### SDK/registry

- Registration/disposal and duplicate `(owner,id)`.
- Manifest permission requirement for source credential access.
- Compile-time callback/result shapes and forbidden output kinds.

### Host lifecycle service

- Every state transition and callback reason.
- Single-flight behavior for double Enable, Enable-vs-Disable, and boot reconcile.
- Output overlap returns 409 without invoking the second plugin.
- Callback failure compensation and retry.
- Plugin Disable preserves desired state; re-enable reconciles.
- Uninstall and Provider delete cleanup ordering.
- Source fingerprint change triggers reconcile before a new runtime session.
- Borrowed API key never changes credential owner.
- Exclusive Codex OAuth lease acquires/returns the same credential ref through
  idempotent prepare/commit callbacks and recovers every crash boundary.
- Active-run rejection, plugin suspension retention, permission-revoke return,
  uninstall return, and Provider-delete destruction have distinct tests.
- Event is post-commit and sanitized.
- Secret scanning assertions against stored/returned/logged values.

### Routing/runtime

- Direct native route wins over enabled extension.
- Direct native route is bypassed while an exclusive OAuth lease is extension-owned.
- Built-in universal behavior is unchanged.
- Extended route is selected only for an otherwise-incompatible runtime.
- Unavailable/suspended/error binding is not routable.
- Public model preference is stable while effective model is prefixed.
- Idle runtime invalidates on transition; active run retains its original route.
- Provider list/API/Web selection reflects effective kinds.

### Web

- Fixture-driven View states listed in the HTTP/UI section.
- One pending mutation per row; failed Enable offers retry and does not show
  enabled.
- Inapplicable reason and unavailable/suspended state are visible but safe.
- Manual and external target containers invalidate target/extension/model queries.
- No direction picker and no global enable control exist.

### CPA

- Config renderer, atomic file behavior, permissions, stable routing prefix,
  per-binding updates, health/reconcile, last-binding stop, redaction.
- Lossless Codex credential adapter, binding-prefix account isolation, refresh
  export, two-phase lease recovery, and managed/legacy auth-directory isolation.
- No external Provider source, manual OAuth login route/buttons, or global
  account selection state.
- Real pinned-binary protocol acceptance as a release gate where runnable.

## Done criteria

All must hold:

- [ ] Enabling CPA for one Provider does not change the number or identity of
  `provider_targets` rows.
- [ ] Plugin activation alone creates no Provider, writes no upstream entry, and
  does not require login or autostart CPA.
- [ ] Provider detail offers exactly per-extension Enable/Disable with plugin
  labels and no conversion selector.
- [ ] `onEnable`, `onDisable`, and `onReconcile` are awaited, serialized, tested,
  and run before registration/plugin/Provider destructive cleanup.
- [ ] Native routing precedence for static credentials, exclusive extension
  routing for leased OAuth, one-hop-only behavior, and output-kind conflict 409
  are covered by tests.
- [ ] Source secrets exist only in the lifecycle callback/config writer path;
  CPA output key is Host-encrypted and runtime responses expose only a ref.
- [ ] Codex OAuth Enable/Disable requires no CPA login, preserves the same Host
  credential ref, transfers the latest refresh state losslessly, and proves one
  active owner at every normal/crash-recovery state.
- [ ] Two OAuth Provider bindings with the same model are selected by stable
  prefix and never enter CPA's cross-account round-robin/failover pool.
- [ ] Public and effective model ids are both tested; two Providers with the same
  public model id cannot collide in CPA.
- [ ] Plugin Disable suspends desired bindings and reactivation reconciles them;
  uninstall removes them after cleanup.
- [ ] CPA aggregate external Provider source and manual OAuth login UI/routes are
  absent; binding-owned managed auth files are lifecycle-controlled and unrelated
  legacy account files are preserved inert.
- [ ] OpenAPI-generated clients, Server/Web typechecks, focused Host/CPA tests,
  builds, changed-file lint, and `git diff --check` pass.
- [ ] No files outside the Scope lists are modified except reviewed generated
  migration/API metadata and the SDK version lock/catalog update.
- [ ] `plans/README.md` row is updated with final status and verification notes.

## STOP conditions

Stop and report; do not improvise if:

- Plan 073 or another branch has changed Provider identity, target API, or the
  two detail surfaces in a way that conflicts with these excerpts.
- The next Drizzle migration number is already claimed or generation proposes a
  change to existing Provider/credential tables beyond the specified FKs.
- Supporting CPA requires inserting/projecting another Provider target, changing
  the durable Provider kind, or asking the user to choose a conversion direction.
- The pinned CPA version does not support deterministic prefixed
  `openai-compatibility` entries or cannot translate those entries through its
  Anthropic-compatible endpoint. Report the exact version/config/wire result;
  do not substitute an undocumented route or hidden priority.
- A pinned-binary Codex OAuth auth file cannot be transformed losslessly to/from
  Cradle's existing `chatgpt-auth` owner value, cannot be disabled before Host
  commit, cannot be exported after refresh, or loses its binding prefix.
- Two prefixed Codex OAuth files can still round-robin/fail over across bindings
  on either OpenAI/Responses or Anthropic-compatible routes. Do not represent a
  pooled CPA account as two distinct Cradle Providers.
- CPA cannot configure a safe finite model map from the Provider's explicit
  enabled/custom inventory. Do not guess wildcard models; keep the Provider
  inapplicable and report the missing upstream capability.
- Any lifecycle callback requires storing plaintext source/output credentials in
  a binding row, activation JSON, route response, event, or log.
- Clean Provider deletion or plugin uninstall would require skipping a failed
  cleanup callback and orphaning an upstream credential in generated config.
- Runtime projection would require mutating an already-active run or persisting
  converter-prefixed ids as user model preferences.
- OAuth support would require both Cradle and CPA to actively use/refresh a token,
  or would resume native routing before CPA's managed auth is disabled. The
  exclusive lease is mandatory; do not downgrade it to periodic file sync.
- The published SDK is unavailable to `cradle-plugins`. Stop for release/operator
  coordination; do not copy Host-private types or commit a local filesystem link.
- A focused verification fails twice after a reasonable correction or requires a
  full-suite workaround outside this plan's scope.

## Maintenance notes

- A future converter adds one SDK contribution and per-Provider binding; it must
  not add Host UI branches keyed by plugin name. Reviewers should reject
  CPA-specific checks outside the CPA plugin and fixtures.
- Adding extension chaining requires a separate graph/cycle/priority design. V1's
  one-hop selection and overlap rejection must stay until that design exists.
- Any future refreshable credential kind must provide its own lossless owner
  codec and pass the same exclusive-lease gates. Do not assume the Codex auth-file
  adapter applies to Claude/Gemini. Preserved CPA legacy account files are not
  migration input unless a later explicit import design says so.
- If CPA gains a management API suitable for atomic config transactions, the
  plugin may replace file rewrites internally without changing Host binding or
  lifecycle semantics.
- Review generated OpenAPI and migration diffs rather than accepting them as
  opaque output. Pay special attention to accidental activation/credential JSON
  exposure and to Web callers that still filter only on durable `providerKind`.
