<!-- Once this directory changes, update this README.md -->

# Provider Extensions

This module owns durable, per-Provider extension bindings. A binding augments an
existing Provider target and never creates, imports, or projects another
Provider.

| Area | Owner | Responsibility |
| --- | --- | --- |
| HTTP contract | [`index.ts`](./index.ts) and [`model.ts`](./model.ts) | Lists safe binding status and accepts only `{ owner, id, enabled }`. |
| Lifecycle and leases | [`service.ts`](./service.ts) | Serializes transitions, awaits plugin callbacks, transfers credential ownership, persists activation state, and reconciles failures. |
| Plugin registration | [`../../plugins/provider-extension-registry.ts`](../../plugins/provider-extension-registry.ts) | Validates declared conversions and requires `provider.credentials.use`. |
| Runtime projection | [`service.ts`](./service.ts) and [`../provider-targets/service.ts`](../provider-targets/service.ts) | Selects a non-conflicting extension route and projects an effective kind, config, credential ref, and model id. |
| Notifications | [`events.ts`](./events.ts) | Publishes post-commit lifecycle events without making them a second source of authority. |

## Ownership and lifecycle

The Host stores user intent, observed status, recovery metadata, and encrypted
output credentials. A plugin owns converter semantics and executable callbacks.
The Host decrypts a source credential only inside an awaited callback, and
activation/status/runtime metadata never contains raw credential material.

`GET /provider-targets/:providerTargetId/extensions/` is a safe status
projection. `PUT` accepts only `{ owner, id, enabled }`; conversion direction and
credential strategy are declared by the extension, not selected separately by
the user.

Enable and Disable are serialized per binding. `onEnable`, `onDisable`, and
`onReconcile` are authoritative and awaited. Lifecycle events are emitted only
after a durable transition. Plugin Disable suspends live state while preserving
`desiredEnabled`; reactivation reconciles it. Confirmed uninstall invokes
cleanup while callbacks are available, returns any leased credential, and then
removes the binding.

Applicability is also authoritative at routing time. If an installed runtime or
Provider configuration stops satisfying an extension, the binding contributes
no effective Provider kinds and no runtime route. A registered extension can
still be disabled so its callback can clean up; an already-suspended Host-owned
binding can also cancel its remembered intent while its plugin is unavailable.

## Credential strategies

Borrowed-static credentials remain Host-owned. The plugin receives their value
only during Enable/Reconcile, and the Host re-runs Reconcile when the source
fingerprint changes.

Exclusive-refreshable credentials use Prepare/Commit Acquire and Prepare/Commit
Release callbacks. The durable lease epoch and phase make every step retryable;
only one side may actively use or refresh the credential. Runtime sessions and
public secret mutations cannot access a credential while the extension owns it.
Only one exclusive-refreshable binding may hold or request the lease for a
Provider target, even when multiple extensions add non-overlapping output kinds.

## Runtime selection

Native routing wins for borrowed credentials. An exclusive lease routes every
compatible runtime through its extension until ownership returns to the Host.
Two enabled extensions may coexist only when their output Provider kinds do not
overlap; a conflicting Enable returns HTTP 409 instead of applying hidden
priority.

Runtime consumers must use the Provider-target resolver. They must not read
activation JSON, output credential refs, or binding rows directly. The resolver
keeps the public Provider/model identity while projecting the extension's
effective Provider kind and model id for the runtime call.
