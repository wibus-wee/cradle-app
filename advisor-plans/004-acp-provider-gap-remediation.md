# 004 - ACP Runtime Negotiation, Turn Correctness, and Authentication

## Objective

Make the ACP Chat Runtime boundary fail predictably and support ACP-native
authentication without persisting credential values in ACP-owned storage.
The implementation covers three related areas:

1. retain and validate the result of ACP initialization;
2. make prompt concurrency, deadlines, cancellation, and stop reasons explicit;
3. persist an installed agent's auth selection as secret references, inject
   env-var credentials before process spawn, and send `authenticate` before
   session methods.

The current gaps are recorded in the
[ACP runtime GAP document](../apps/server/src/modules/chat-runtime-providers/acp/GAP.md).
Update that document only after each behavior is implemented.

## Scope

| Area | Owner | Planned responsibility |
| --- | --- | --- |
| ACP wire protocol | [`connection-manager.ts`](../apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts) | Initialization, typed requests, deadlines, auth handshake, session channels, and native-to-runtime errors. |
| Agent process | [`process-manager.ts`](../apps/server/src/modules/chat-runtime-providers/acp/process-manager.ts) | Spawn with resolved env, stop an unhealthy process, and retain bounded stderr diagnostics. |
| Runtime projection | [`provider.ts`](../apps/server/src/modules/chat-runtime-providers/acp/provider.ts) | Connection resolution, session fallback policy, and Chat Runtime error/finish projection. |
| Auth configuration | [`modules/acp`](../apps/server/src/modules/acp) | Persist the selected auth method and env-name-to-secret-ref bindings; expose HTTP/CLI commands. |
| Credential values | [`modules/secrets`](../apps/server/src/modules/secrets) | Encrypt, store, and resolve credential values. ACP stores references only. |
| Shared errors | [`chat-runtime-contracts`](../packages/chat-runtime-contracts/src/index.ts) | Represent generic provider auth-required failures without ACP-specific frontend parsing. |

This plan does not register Cline or another agent, add terminal-based auth,
build an ACP-specific web auth screen, implement elicitation, add remote ACP
transports, or address other entries in `GAP.md`.

## Verified protocol and runtime facts

The protocol source of truth is `@agentclientprotocol/sdk` 1.2.1 and its
generated types in `node_modules/@agentclientprotocol/sdk/dist`.

- `InitializeResponse` already remains intact on `ConnectionEntry.initResult`.
  The missing piece is a single typed read path for its protocol version,
  capabilities, agent info, and auth methods.
- ACP protocol version 1 is a breaking-version identifier. An agent returns
  the requested version when supported or its latest version otherwise; the
  client must disconnect when it cannot support the returned version.
- `ClientContext.request` accepts `SendRequestOptions.cancellationSignal`.
  Aborting sends `$/cancel_request`, but cancellation is cooperative and the
  returned promise remains pending until the peer responds. A deadline must
  therefore both abort the request and settle Cradle's local operation.
- The SDK exports `RequestError` with numeric `code` and optional `data`.
  `RequestError.authRequired()` uses `-32000`; no message parsing is needed.
- `PromptResponse.stopReason` is one of `end_turn`, `max_tokens`,
  `max_turn_requests`, `refusal`, or `cancelled`.
- AI SDK `FinishReason` accepts `stop`, `length`, `content-filter`,
  `tool-calls`, `error`, and `other`.
- Chat Runtime owns failed and aborted terminal chunks. A provider timeout must
  throw a typed error; a user cancellation must unwind the provider stream;
  neither path should emit a successful `finish` chunk first.
- [`resumeChatSession`](../apps/server/src/modules/chat-runtime-providers/acp/provider.ts)
  currently catches every resume/load error and silently creates a new native
  session. That would hide auth failures, timeouts, and protocol faults.
- `provider-auth/credential-lifecycle.ts` coordinates refreshable token
  refresh. It is not the generic credential store. Static ACP env-var values
  are read through `ProviderContext.readSecret` from the Secrets owner.
- The existing Codex re-auth error is translated only in the provider-model
  catalog path. It is not a reusable Chat Runtime auth UI channel.
- Existing ACP tests cover MCP projection and timeline mapping, but do not
  construct `AcpConnectionManager`. This plan must add a real manager harness;
  it cannot rely on a fake-double pattern that does not exist.

## Cross-cutting invariants

- Never write auth secret values introduced by this plan to `acp_agents`,
  runtime config JSON, snapshots, audit details, logs, errors, test snapshots,
  or `GAP.md`. Existing plaintext launch `env` storage remains a separately
  recorded gap and is not expanded by this work.
- Persist only the selected auth method ID and a map from advertised env names
  to Secrets-owned credential IDs.
- Resolve secret values immediately before process spawn. Keep them only in
  the spawn input and child environment; do not cache them on connection or
  auth view objects.
- Never infer auth failure from error-message text. Match `RequestError` and an
  exact code. If a real agent uses another representation, record that exact
  representation and add an explicit mapping.
- Every native request has one lifecycle owner and a bounded local deadline.
  A timed-out connection is unhealthy and must not remain available for later
  sessions.
- A native session has at most one active prompt channel. Chat Runtime already
  serializes turns per chat session; the ACP guard is a race backstop, not a
  second queue.
- Normal prompt completion emits one finish chunk. Provider failure throws and
  user cancellation unwinds; Chat Runtime creates their terminal chunks.
- Do not widen `clientCapabilities`. Terminal and elicitation handlers remain
  unadvertised.

## Workstream A - Connection negotiation and bounded requests

### A1. Report the server package version

Use the existing package-JSON import pattern from
[`telemetry/resource.ts`](../apps/server/src/telemetry/resource.ts). Send
`apps/server/package.json`'s version as `clientInfo.version` instead of the
hardcoded `1.0.0`. Do not add a second version constant.

### A2. Make initialization the connection contract

After `initialize` resolves:

1. require `initResult.protocolVersion === PROTOCOL_VERSION`;
2. on mismatch, close the SDK connection, stop the spawned process, and throw
   `ProviderRuntimeError(ProviderErrors.requestFailed(...))` naming both
   versions;
3. only then publish the entry in `connections`;
4. expose typed accessors for the negotiated version, full auth method list,
   and capability predicates;
5. route `supportsLoadSession` and `supportsResumeSession` through the same
   capability accessor.

If spawn, stream connection, initialize, validation, or auth fails before the
entry is published, clean up both the SDK connection and process. No failed
connect may leave an orphan child process.

### A3. Add one deadline helper

Add a private typed request helper in the ACP boundary. It must:

- accept the method, params, operation label, and timeout;
- create an `AbortController` and pass its signal to SDK `request`;
- race the cooperative SDK promise against Cradle's deadline so the local
  caller settles even when the peer ignores cancellation;
- attach a terminal rejection handler to the SDK promise before racing;
- clear the timer in `finally`;
- convert timeout into `ProviderRuntimeError` with the ACP runtime kind,
  operation, and duration;
- preserve `RequestError` as the cause for later exact auth classification.

Constructor options own deterministic budgets:

| Operation | Default |
| --- | ---: |
| `initialize`, `session/new`, `session/load`, `session/resume`, config writes | 30 seconds |
| `authenticate` | 5 minutes |
| `session/prompt` | 10 minutes |

Tests inject short budgets or fake timers; production does not read timeout
values from environment variables.

On a metadata or prompt timeout, abort the request, best-effort notify
`session/cancel` when a session exists, close the SDK connection with the typed
error, fail all local channels, remove the connection entry, and stop the
process. Killing the per-agent process is intentional: after a peer ignores
protocol cancellation, its session state and pending-request capacity are no
longer trustworthy.

## Workstream B - Turn correctness

### B1. Reject overlapping prompts

Before installing a new `SessionChannel`, reject when `conn.channels` already
contains the native session ID. Use `ProviderErrors.requestFailed` and include
the agent connection key and native session ID. Do not replace, cancel, or
queue behind the existing channel.

The guard and channel insertion must be synchronous relative to each other.
Cleanup removes the channel only when the map still points to that exact
channel instance.

### B2. Separate normal, failed, and cancelled termination

Normal response:

1. capture usage from `PromptResponse`;
2. flush open mapper blocks;
3. emit exactly one mapped finish chunk;
4. close the queue.

Provider error or timeout:

1. flush mapper blocks that were already received;
2. fail the queue with `ProviderRuntimeError`;
3. do not emit `finish`; `turn-executor.ts` will persist an `error` terminal.

User cancellation:

1. mark the channel cancelled before sending `session/cancel`;
2. abort the in-flight prompt request as well as sending the ACP notification;
3. close the local queue immediately without awaiting the peer;
4. do not emit `finish`; the active-run cancellation owner persists `abort`.

Late prompt settlement after cancellation or timeout may perform cleanup but
must not enqueue chunks, usage, or another terminal result.

### B3. Map native stop reasons

Map successful `PromptResponse.stopReason` values as follows:

| ACP stop reason | AI SDK finish reason |
| --- | --- |
| `end_turn` | `stop` |
| `max_tokens` | `length` |
| `max_turn_requests` | `other` |
| `refusal` | `content-filter` |
| `cancelled` | `other` |

Keep this mapping exhaustive over the SDK `StopReason` type. A returned
`cancelled` response is not automatically a user abort: only Chat Runtime's
own `cancelRequested` state owns that classification.

### B4. Preserve resume failures

Replace the two blanket `catch` blocks in `resumeChatSession` with an explicit
fallback predicate. Fall back from resume to load/new only for SDK
`RequestError` codes `-32601` (`methodNotFound`) or `-32002`
(`resourceNotFound`). Re-throw auth-required, timeout, process, protocol, and
unknown failures.

If a real agent uses another exact code for a missing session, record the wire
response before adding it. Do not match message substrings.

## Workstream C - Shared auth-required contract

Add a provider-neutral auth method view to
[`chat-runtime-contracts`](../packages/chat-runtime-contracts/src/index.ts):

```ts
export interface ProviderAuthMethod {
  id: string
  name: string
  description?: string
  kind: 'agent' | 'env_var' | 'terminal'
  status: 'supported' | 'unsupported'
  unavailableReason?: string
  link?: string
  fields?: Array<{
    name: string
    label?: string
    secret: boolean
    optional: boolean
  }>
}
```

Extend `ProviderError` with
`{ _tag: 'auth_required', provider: string, methods: ProviderAuthMethod[] }`
and add `ProviderErrors.authRequired`. Update the exhaustive formatters in the
contract and [`run/errors.ts`](../apps/server/src/modules/chat-runtime/run/errors.ts).
The serialized payload may include auth metadata but never secret refs or
values.

Keep `auth_failed` for a selected method whose `authenticate` request fails.
Use `auth_required` when no usable selection exists or the agent rejects a
session request with `RequestError.code === -32000`.

## Workstream D - ACP auth projection, persistence, and API

### D1. Project auth methods faithfully

Add `auth.ts` beside the ACP connection manager. Project SDK `AuthMethod`
without frontend-only guesses:

- no `type` means `agent`;
- `env_var` includes `link` and normalized fields; omitted `secret` defaults
  to `true`, omitted `optional` defaults to `false`;
- `terminal` is returned with `status: 'unsupported'` and a stable reason;
- `agent` and `env_var` are supported.

Projection must not include terminal `args`, terminal `env`, `_meta`, secret
refs, or secret values.

### D2. Persist selection in the ACP namespace

Add a reviewed Drizzle migration for nullable `auth_method_id` and
`auth_secret_refs_json` (default `{}`) on `acp_agents`. These fields belong on
the installed agent because one process and one connection are keyed by
`acp:<agentId>` and shared by that agent's sessions.

The persisted map is `{ [advertisedEnvName]: credentialId }`. Validate it
against the currently advertised method before saving:

- reject unknown variables;
- require every non-optional variable;
- reject refs for agent auth;
- reject terminal auth because the client does not advertise terminals;
- preserve user-owned Secrets rows when selection is changed, cleared, or the
  ACP agent is uninstalled.

Registry reinstall preserves the selection. If the updated binary no longer
advertises it, connection returns `auth_required`; it does not silently choose
another method.

### D3. Expose complete server-side operations

Add TypeBox models, service methods, module README entries, and routes:

| Method | Path | CLI | Behavior |
| --- | --- | --- | --- |
| `GET` | `/acp/agents/:agentId/auth-methods` | `acp agent auth-methods` | Ensure an initialization result exists; return projected methods and selected method ID. |
| `PUT` | `/acp/agents/:agentId/auth` | `acp agent auth-set` | Validate and persist `{ methodId, secretRefs }`, then reconnect and authenticate. |
| `DELETE` | `/acp/agents/:agentId/auth` | `acp agent auth-clear` | Clear the selection and disconnect the current process. |

Expose generated CLI metadata for all three operations. The PUT route accepts
credential IDs only. Users create or update credential values through the
Secrets owner; ACP never accepts plaintext credential values.

The route layer may obtain the registered `AcpChatProvider` using the existing
draft-session composition pattern, but persistence and validation semantics
remain in `modules/acp/service.ts` and runtime handshake semantics remain in
the ACP provider boundary.

### D4. Authenticate before session lifecycle methods

Extend the resolved ACP connection record with the persisted method ID and
secret-ref map. Inject `ProviderContext.readSecret` into the connection
manager; resolve each selected env-var value immediately before spawn.

Every cold connection first spawns without ACP auth secret values, initializes,
validates the protocol version, and reads the current auth methods. This
discovery stage prevents a changed agent binary or method contract from
receiving credentials based only on stale persisted metadata.

After discovery:

1. no selection keeps the discovery connection and allows session requests;
2. an `agent` selection sends `authenticate` on the discovery connection;
3. an `env_var` selection validates the exact advertised fields, closes and
   stops the discovery connection, resolves the selected secret refs, respawns
   once with those env values, initializes again, revalidates the method, and
   sends `authenticate`;
4. a successful handshake marks the published connection entry with
   `authenticatedMethodId` before session requests are allowed.

Saving or clearing a selection disconnects the current process. The next
connection follows the same discovery sequence. Never mutate a live child
process environment, and never publish the short-lived discovery connection
while an auth-selected reconnect is in progress.

When no selection exists, do not assume advertised methods mean the agent is
currently unauthenticated. Attempt the session operation and map only an exact
`RequestError(-32000)` to `ProviderErrors.authRequired` with the projected
method list. This preserves agents that advertise login methods while reusing
provider-owned login state.

When a selected method's `authenticate` request fails, throw `auth_failed` and
retain the persisted refs for explicit correction or retry. If a later
session or config request returns exact `RequestError(-32000)`, clear only the
connection-local authenticated marker and throw `auth_required`. Do not
automatically retry an operation that may have reached the agent.

## Tests

Add a manager-level harness using an in-memory ACP SDK peer plus a narrow
process-manager test boundary. Do not spawn a real child process in unit tests.

Focused coverage must include:

1. initialization reports the server package version, exposes the complete
   result, and cleans up process + connection on version mismatch;
2. every request class receives its configured deadline;
3. a peer that ignores cooperative cancellation causes local timeout,
   `$/cancel_request`, best-effort `session/cancel`, connection teardown, and
   no unhandled rejection;
4. a second prompt on one native session is rejected without disturbing the
   first channel;
5. each ACP stop reason emits exactly one expected finish chunk;
6. provider failure emits no finish and user cancellation emits no finish;
7. late completion after timeout/cancel cannot mutate queue or usage state;
8. resume/load auth and timeout errors are not swallowed by fallback;
9. auth projection applies SDK defaults and marks terminal auth unsupported;
10. persisted auth config contains refs only, validates required/unknown vars,
    and survives registry reinstall;
11. cold env-var auth discovers and validates without secrets before exactly
    one credential-bearing respawn; values do not appear in records, logs,
    errors, audit entries, or snapshots;
12. `authenticate` precedes every session method and repeated ensure/connect
    calls do not open a second process;
13. exact `RequestError(-32000)` becomes `auth_required`; unrelated JSON-RPC
    errors remain request failures;
14. GET/PUT/DELETE auth route contracts and generated CLI metadata are valid.

## Validation

Run focused checks only; do not restart an existing development server and do
not run browser tests.

```bash
pnpm --filter @cradle/db generate
pnpm vitest run apps/server/src/modules/chat-runtime-providers/acp \
  apps/server/src/modules/acp
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server check:boundaries
pnpm exec eslint \
  packages/chat-runtime-contracts/src/index.ts \
  packages/db/src/schema/acp.ts \
  apps/server/src/modules/chat-runtime-providers/acp \
  apps/server/src/modules/acp
git diff --check
```

Inspect generated migration SQL and metadata before accepting them. Do not
hand-edit generated Drizzle snapshots.

## Real-agent verification

This verification is opt-in and must use an explicitly named binary/version.
It must not reuse or mutate provider-owned home state without approval.

1. register an auth-required ACP agent against a temporary workspace;
2. GET advertised methods and record the exact JSON-RPC auth-required shape;
3. create Secrets-owned credentials, PUT their refs as the auth selection, and
   verify `authenticate` occurs before `session/new`;
4. run one small prompt and verify the mapped finish reason;
5. cancel one prompt and verify the Cradle run becomes `aborted`;
6. use an injected test-only short deadline or a controlled fake agent to
   verify timeout tears down the unhealthy process and the next operation
   reconnects cleanly;
7. confirm no credential value appears in audit output, stderr capture,
   observability, or runtime snapshots.

Do not claim end-to-end auth UX complete until a separate web surface can list
methods, select existing Secrets credentials, and retry session creation. This
plan delivers the protocol, storage, HTTP/CLI, and generic error foundations.

## Implementation order

1. A: request lifecycle, initialization validation, and cleanup.
2. B: prompt exclusivity, terminal semantics, and strict resume fallback.
3. C: shared provider auth-required contract.
4. D1-D2: auth projection and durable reference schema.
5. D3-D4: HTTP/CLI operations and runtime handshake.
6. focused tests, type/boundary checks, `GAP.md`, and module README updates.
7. optional real-agent verification after the unit/contract checks pass.

Each step should remain independently reviewable. Do not combine the schema
migration with unrelated ACP gap work.

## Completion criteria

- A hung ACP request cannot leave a Cradle run streaming indefinitely.
- An unhealthy timed-out connection is removed and its child process stops.
- Concurrent prompts cannot silently replace each other's update channel.
- Normal ACP stop reasons survive projection into the stored terminal chunk.
- Resume fallback never hides auth, timeout, process, or protocol failures.
- Auth selection survives server restart without storing secret values in the
  ACP namespace.
- Exact ACP auth-required failures retain projected method metadata in the
  shared provider error payload.
- An API/CLI user can discover methods, select Secrets-owned credential refs,
  authenticate, create a session, and run a prompt.
- Remaining unsupported behavior is accurately listed in `GAP.md`.
