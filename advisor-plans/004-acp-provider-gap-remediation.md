# 004 — ACP Chat Runtime Gap Remediation: Initialization Negotiation, Turn Correctness, Authentication

## Goal

Close three tiers of gaps in the ACP chat runtime projection
(`apps/server/src/modules/chat-runtime-providers/acp/`) recorded in that
directory's `GAP.md`:

1. **Initialization negotiation** — the provider discards almost all of the
   `InitializeResponse`; capability gating has no data source.
2. **Turn correctness** — concurrent prompts on one native session corrupt
   timelines; hung agents leave runs streaming forever; `stopReason` is thrown
   away so refusals/cancellations render as normal turn ends.
3. **Authentication chain** — Cradle never reads `authMethods`, never sends
   `authenticate`, and cannot recover from auth-required failures. This blocks
   every registry agent that requires sign-in (motivating example: Cline via
   `cline --acp`, whose free models require account login).

This plan is server-side only. It deliberately does NOT register any specific
agent (e.g. Cline) and does NOT build new web UI screens; where a frontend
surface is needed it reuses the existing Codex re-auth error channel.

## Protocol source of truth

`@agentclientprotocol/sdk` **1.2.1** (`node_modules/@agentclientprotocol/sdk`),
plus https://agentclientprotocol.com. Verified facts (from
`dist/schema/types.gen.d.ts` unless noted):

- `InitializeResponse.authMethods?: Array<AuthMethod>` (line 1422).
- `AuthMethod` is a union discriminated by `type`: `"env_var"`
  (`AuthMethodEnvVar`, with `vars: Array<AuthEnvVar>`; each var has `name`,
  optional `label`, `secret` default true, `optional` default false),
  `"terminal"` (`AuthMethodTerminal`, optional `args`/`env` for interactive
  binary auth), or `AuthMethodAgent` (no `type` on the wire; agent handles
  auth itself, e.g. browser OAuth). All variants share `id`, `name`,
  optional `description`.
- `ClientContext.authenticate(params)` exists (`dist/acp.d.ts:1131`); the
  agent method name is `"authenticate"`, request carries `{ methodId }`.
- `PromptResponse.stopReason: StopReason` where
  `StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"` (line 3027).
- JSON-RPC errors use reserved codes `-32000..-32099`. Agents signal
  **authentication required** with code `-32000` (per
  agentclientprotocol.com). If an observed agent uses a different code,
  treat `-32000` as primary but match message content as fallback, and
  record what the real binary sends.

## Current state (verified against source)

All paths relative to repo root. File:line references were accurate at
authoring time; re-locate by symbol name if lines drifted.

### `connection-manager.ts`

- `connect()` dedupes concurrent connects via `pendingConnects`;
  `openConnection()` (line 394) spawns the agent through `AcpProcessManager`,
  builds `client({ name: 'Cradle Server' })`, registers handlers for
  `session.requestPermission`, `session.update`, `fs.readTextFile`,
  `fs.writeTextFile`, then sends `initialize` with `PROTOCOL_VERSION` and
  hardcoded `clientInfo: { name: 'Cradle Server', version: '1.0.0' }`
  (lines 419–428).
- The full `InitializeResponse` **is** retained on the connection entry
  (`ConnectionEntry.initResult`, line 143), but the only readers are
  `supportsLoadSession()` / `supportsResumeSession()`. `authMethods`,
  negotiated `protocolVersion`, and the rest of `agentCapabilities` are never
  consulted.
- `prompt(agentId, sessionId, message, runtimeContext?)` (~line 280) creates
  `SessionChannel { mapper, queue, closedBy }` and does
  `conn.channels.set(sessionId, channel)`. **A second overlapping prompt on
  the same native session overwrites the map entry; the first run stops
  receiving updates mid-flight.** No guard, no queueing, no timeout:
  `conn.agent.request(methods.agent.session.prompt, …)` (line 298) hangs
  indefinitely if the agent hangs after accepting.
- Prompt completion stores usage from the final `PromptResponse`
  (`toTokenUsage`, lines 634–652). `response.stopReason` is **never read**.
- Cancel path (`closeChannel` `{ kind: 'cancelled' }`) closes the queue; the
  consuming generator returns early (lines 331–334) **without emitting a
  finish chunk**, so a cancelled turn just… ends.
- Errors are plain `Error`s. Nothing typed escapes this module except
  permission outcomes.

### `runtime-integration.ts` / `provider.ts`

- `wireAcpIntegration` routes permission requests into
  `requestProviderToolApproval` (kit permission bridge); resolution is binary
  (first `allow_*` option) — known gap, out of scope here.
- `AcpChatProvider.startChatSession` ensures connection, resumes-or-creates
  the native session, applies model via config options; `streamTurn` iterates
  `runtime.prompt(...)`; errors propagate raw.

### Existing precedents you must reuse

- **Typed provider errors**: `ProviderErrors` / `ProviderRuntimeError` come
  from `@cradle/chat-runtime-contracts` (re-exported by
  `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`). Read
  their definitions in `packages/chat-runtime-contracts` before inventing.
- **Re-auth surfaced to users**: Codex defines
  `CodexChatgptAuthReauthRequiredError` with a stable `code` property
  (`codex/app-server/chatgpt-auth.ts:33`); `provider-catalog/catalog.ts:256`
  translates it for consumers; `host-lease.ts` maps it across leases. The ACP
  auth-required error must travel this same channel.
- **Credential lifecycle**: `modules/provider-auth/credential-lifecycle.ts`
  owns refresh/reauth drivers over the secrets service. Env-var auth secrets
  belong behind that boundary, not in `acp_agents.env` JSON.
- **Finish reasons**: `kit/chunk-mapper.ts` exposes
  `providerChunk.finish(finishReason)`. Native-mapping precedents:
  `kimi/event-to-chunk-mapper.ts:142` (failed/blocked → `'error'`),
  `opencode/event-stream.ts:865`. Verify the allowed `finishReason` union
  from AI SDK's `UIMessageChunk` finish variant rather than trusting any list
  blindly.

### Test infrastructure

`connection-manager.test.ts` / `timeline-mapper.test.ts` exist in the acp
package and construct the manager with fake doubles. Follow their patterns.
Tests run with vitest from repo root.

## Constraints (hard rules)

- Never persist credentials in `acp_agents` rows, launch configs, logs, or
  error messages. Secrets go through the secrets service / `provider-auth`
  boundary only. Log key names only, never values.
- Do not widen advertised `clientCapabilities`; do not advertise terminal or
  elicitation — those stay GAP'd.
- Do not implement mode switching, slash commands, tool-kind mapping, or
  reconnect/respawn here. They remain in `GAP.md`.
- Match existing style: TypeScript strict, named exports, JSDoc only for
  non-obvious contracts.

## Workstream A — Initialization negotiation

**Files**: `connection-manager.ts`, new `auth.ts` (built in Workstream C),
`GAP.md`.

### A1. Honest `clientInfo`

Replace the hardcoded `'1.0.0'` with the actual server package version.
Grep for an existing runtime version accessor in `apps/server/src` (health /
report modules); if none exists, keep a module-level constant adjacent to a
comment stating it must track the server release. Do not import JSON with a
new loader pattern just for this.

### A2. Retain and expose the full initialize result

Add to `AcpConnectionManager` accessors over the stored `initResult`, at
minimum:

```ts
getNegotiatedProtocolVersion(agentId: string): number | undefined
getAuthMethods(agentId: string): AuthMethod[]
supportsCapability(agentId: string, predicate: (caps: AgentCapabilities) => boolean): boolean
```

Signatures may flex to fit call sites; the invariant is that no caller
re-derives capability facts from anything other than the stored `initResult`.
Refactor `supportsLoadSession` / `supportsResumeSession` onto this path so
there is one reading route.

### A3. Typed version failure

After `initialize` resolves, validate the negotiated `protocolVersion`
against what this client requires. First inspect what tolerance the SDK
already applies — do not double-enforce. If Cradle's requirement is stricter,
fail with a `ProviderRuntimeError` (via `ProviderErrors`) whose message names
both versions. Today's behavior (inscrutable downstream protocol errors) is
the thing being replaced.

### A4. Update `GAP.md`

Rewrite the "Initialization negotiation" section to describe what remains
(e.g. `_meta` forwarding if still unread). State what changed; do not delete
history silently.

## Workstream B — Turn correctness

**Files**: `connection-manager.ts`, `GAP.md`. Finish-chunk emission lives in
the manager, not the mapper (see B3).

### B1. Reject concurrent prompts per native session

In `prompt()`, before creating a channel: if `conn.channels.get(sessionId)`
exists and is not closing, throw a `ProviderRuntimeError` naming agent,
native session, and the fact that another run is active. Do NOT silently
rebind. Queueing is a deliberate non-goal: Chat Runtime already serializes
turns per chat session upstream; the rejection is a backstop against races,
and a wrong-silent-failure is worse than a loud one. Record this decision in
`GAP.md`.

### B2. Bounded prompt lifetime

Bound the `session/prompt` request in time. First inspect whether the SDK's
`ClientContext.request` accepts an abort/signal; use it if so, otherwise
`Promise.race` (verify losing-promise rejections cannot go unhandled). Policy:

- Total turn budget exported as e.g. `ACP_PROMPT_TIMEOUT_MS`, default
  **10 minutes**, overridable via manager constructor options (not env vars).
- On timeout: typed error ("ACP agent prompt timed out after Xms"),
  best-effort `this.cancel(agentId, sessionId)` so the agent receives
  `session/cancel`, channel closed as disconnected with that error. The run
  must reach a terminal state; never leave the consumer awaiting forever.
- Same bounding for `newSession` / `loadSession` / `resumeSession` with a
  **30s** metadata budget.

Test determinism: fake timers or injected tiny timeout via constructor
options; never sleeps.

### B3. Project `stopReason` into the finish chunk

Mapping (validate each target against AI SDK's `UIMessageChunk` finish union;
substitute nearest valid member and comment if any is absent):

| `StopReason` | `finishReason` |
|---|---|
| `end_turn` | `'stop'` |
| `max_tokens` | `'length'` |
| `max_turn_requests` | `'other'` |
| `refusal` | `'content-filter'` |
| `cancelled` | `'other'` |

Implementation: in `prompt()`'s success path push
`providerChunk.finish(mapped)` after the `mapper.flush()` chunks and before
`queue.close()`. The cancel paths (user cancel, B2 timeout) also emit exactly
one finish chunk before close/fail. Every terminal path emits exactly one
finish chunk — assert this invariant in tests.

## Workstream C — Authentication chain

**Files**: new `chat-runtime-providers/acp/auth.ts`, `connection-manager.ts`,
`runtime-integration.ts` (wiring), `provider.ts` (error translation),
`GAP.md`. Depends on A2 (`getAuthMethods`).

### C1. Project auth methods

In `auth.ts`:

```ts
export interface AcpAuthMethodView {
  id: string
  name: string
  description?: string
  kind: 'agent' | 'env_var' | 'terminal'
  // env_var only:
  vars?: Array<{ name: string, label?: string, secret: boolean, optional: boolean }>
}

export function projectAuthMethods(methods: AuthMethod[]): AcpAuthMethodView[]
```

`terminal` methods are projected but marked unusable in v1 — Cradle cannot
sanely host an interactive TUI inside the agent subprocess yet. They stay
visible so the UI can explain why; `GAP.md` records the limitation.

### C2. Send `authenticate` when a selection exists

Flow:

1. After connect, if the stored init result has non-empty `authMethods` and a
   selection exists for this agent (see C4), send
   `conn.agent.request('authenticate', { methodId })` **before** any
   `session/new` / `session/load` / `session/resume`.
2. `env_var` methods need the variables present in the agent process env,
   which is fixed at spawn. Resolving an env-var selection therefore requires
   disconnect → resolve secret values through the secrets service → reconnect
   passing extra env to `processManager.spawn` → `authenticate`. Implement
   exactly that; do not mutate env of a live process.
3. Selection state lives **in memory per agentId** on the manager:
   `Map<string, { methodId: string, envValues?: Record<string, string> }>`.
   Values are never logged. Persisted env-var secrets go through the existing
   secrets service keyed by agent + method id; the in-memory map holds only
   what is needed for the current connection. If wiring persistence through
   the secrets service requires contract changes beyond this plan, STOP and
   report (escape hatch).

### C3. Map auth-required failures to a typed error

Define in `auth.ts`:

```ts
export class AcpAuthRequiredError extends Error {
  readonly code = 'acp_auth_required'
  constructor(message: string, readonly agentId: string, readonly methods: AcpAuthMethodView[])
}
```

Throw it when `session/new`, `session/load`, `session/resume`, or
`session/prompt` rejects with JSON-RPC code `-32000` (detect via the SDK's
error envelope — inspect how the SDK surfaces `data.code`; if it wraps plain
`Error`s, parse defensively and record the real format), or when one of those
calls fails while `authMethods` exist and no authentication has been performed
on this connection.

Translate it at the boundary where Codex translates its re-auth error
(`provider-catalog/catalog.ts` pattern) so the frontend receives the same
"sign in required" signal shape it already handles for Codex. Trace that path
end-to-end first (catalog.ts:256 → web render). If the channel proves
Codex-specific in a way that cannot carry a generic agent auth payload,
implement the typed error + server mapping, wire the web surface as far as
the existing channel allows, and report the remainder as follow-up — do not
build new UI screens in this plan.

### C4. Minimal API surface for selection

Expose on the manager (thread through `AcpChatProvider` if needed):

```ts
listAgentAuthMethods(agentId: string): AcpAuthMethodView[]
selectAgentAuthMethod(agentId: string, input: { methodId: string, envValues?: Record<string, string> }): Promise<void>
isAgentAuthenticated(agentId: string): boolean
```

`selectAgentAuthMethod` performs the handshake (and env-inject respawn for
env_var) and marks the connection authenticated. It must be safe to call
twice — re-authenticate, never open a second connection (reuse `connect()`'s
pending/dedup discipline).

If a REST/IPC route is needed for the web UI to drive selection, check
whether `modules/acp/service.ts` already exposes agent-scoped routes and add
the smallest route consistent with that file's conventions. If it would be
more than a thin passthrough, defer the route to a follow-up plan and report.

### C5. GAP.md rewrite of the Authentication section

Document what now works (capture, selection, authenticate, -32000 recovery),
what stays open (terminal-method TUI hosting, credential vault UX, web UI
depth), and the decision that selections live in memory with secrets in the
secrets service.

## Tests

Follow the fake-double patterns in `connection-manager.test.ts`. One
`describe` per workstream:

1. **A**: init result exposes auth methods + negotiated version; version
   mismatch throws a typed error naming both versions; `clientInfo.version`
   reflects the injected version.
2. **B1**: second `prompt()` on the same session rejects with a typed error;
   the first run keeps receiving updates (channel untouched).
3. **B2**: hanging prompt terminates with a typed timeout error within an
   injected budget; `session/cancel` was notified; finish chunk emitted
   before close.
4. **B3**: exhaustive `StopReason` → `finishReason` mapping; success, user
   cancel, and timeout paths each emit exactly one finish chunk.
5. **C2/C3**: `-32000` on session/new surfaces `AcpAuthRequiredError` carrying
   projected methods; `authenticate` precedes `session/new`; env_var selection
   respawns with env exactly once; secret values never appear in logs or
   errors (assert against spies/fakes).
6. **C4**: calling `selectAgentAuthMethod` twice does not open a second
   connection.

Validation commands (from repo root):

```bash
pnpm --filter @cradle/server typecheck
pnpm vitest run apps/server/src/modules/chat-runtime-providers/acp
pnpm lint --cache   # confirm no new violations in touched files only
git diff --check
```

(If any script name differs from the above, use the repo's actual script —
verify in root/package.json before running.)

## Real-binary verification (manual, opt-in)

With an ACP agent that requires auth registered locally (registration of
specific agents like Cline is out of scope), start the server and create a
session: session/new must fail with the typed auth-required error;
`authenticate` fires after method selection; a subsequent small turn streams.
Record the observed JSON-RPC code/format in `GAP.md`. Never write to agent
home state (e.g. `~/.cline`) from Cradle during this test.

## Escape hatches — STOP and report instead of improvising if:

- The SDK's request path accepts no abort/signal and `Promise.race` would
  leak unhandled rejections on the losing promise.
- Persisted-secrets integration for env-var auth requires schema or
  ownership changes beyond `auth.ts`.
- The Codex re-auth frontend channel cannot carry generic agent auth payloads
  and no equally established alternative exists.
- The real binary's auth-required code differs materially from `-32000` such
  that matching would misfire for other agents.

## Maintenance notes

- A2's capability accessors are the hook future gaps (elicitation, terminals,
  fork gating) will read from — keep them the single source.
- B1's reject-don't-queue decision should be revisited if Chat Runtime ever
  allows true concurrent turns per chat session.
- When Cline is later registered as an ACP agent (separate future plan), its
  free models depend directly on Workstream C working end-to-end; that plan
  should consume `listAgentAuthMethods` / `selectAgentAuthMethod`, never
  bypass them.
