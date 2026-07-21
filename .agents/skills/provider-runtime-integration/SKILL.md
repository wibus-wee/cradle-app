---
name: provider-runtime-integration
description: Implement, upgrade, or audit a native Cradle Chat Runtime provider backed by a local process, REST/WebSocket protocol, or provider-specific agent SDK. Use when adding a runtime like Kimi, Codex, Claude Agent, OpenCode, or another provider that needs generated protocol bindings, target-scoped process lifecycle, canonical tool mapping, runtime UI slots, interaction bridges, streaming recovery, and end-to-end smoke verification.
---

# Provider Runtime Integration

Build a provider as a Cradle-owned projection of a native runtime. Preserve native facts at the transport edge and translate them once into the Chat Runtime contract. Do not advertise a native feature until the matching Cradle contract, lifecycle owner, UI state, and verification path exist.

## Workflow

1. Inspect the existing provider adapters, Chat Runtime contract, runtime installation/configuration, stream transport, and relevant UI slot consumers before designing a new integration.
2. Capture and normalize the executable's live protocol. Generate bindings, then add the host lifecycle and typed transport boundary.
3. Map native capabilities, events, tools, and interactions explicitly into Cradle contracts.
4. Make native session state and Cradle run state converge after reconnects or passive-window joins.
5. Verify the normal path and failure paths against a real local binary. Record native capabilities that cannot be faithfully projected.

## Runtime Ownership

- Store runtime-owned state under `CRADLE_DATA_DIR/runtimes/<runtime>`. Never write, migrate, or delete provider-owned user-home state such as `~/.<provider>`.
- Treat a configured provider target as the host ownership boundary: `N` compatible targets require `N` hosts; sessions on one target share that target's host.
- Fingerprint an owned host with the executable identity, target ID, projected configuration, and irreversible credential fingerprint. Exclude session IDs and temporary bearer tokens.
- Keep temporary loopback credentials in memory. Never log a startup token, weaken the runtime's authentication checks, or expose the native server beyond its intended loopback boundary.
- Define startup, reuse, idle release, crash, and explicit stop behavior. Test host separation, host reuse, and restart after loss.

## Protocol And Typed Client

Use the executable as the protocol source of truth. Snapshot only normalized, reproducible REST/OpenAPI and streaming/WebSocket/AsyncAPI contracts in the Cradle provider namespace; record the native version and snapshot hashes in a manifest.

For REST APIs, generate TypeScript types, Zod schemas, `@hey-api/client-ofetch`, and `@hey-api/sdk`. Keep exactly one handwritten runtime transport boundary, conventionally `<runtime>/http/client.ts`, responsible for:

- an isolated host's `baseUrl`;
- temporary bearer authentication;
- timeout and retry policy; and
- native error-envelope decoding into typed Cradle errors.

Create per-host clients with the generated `createClient()` API or configure generated runtime hooks. Provider code must call generated SDK methods and must not construct REST URLs or request bodies. Default commands to `retry: 0`; opt into retries only after proving an operation is idempotent and the failure mode is safe to repeat.

Generate streaming message catalogues for type validation, then write an explicit event mapper. A schema is not a runtime projection.

## Capability Projection

Implement only the applicable `ChatRuntime` hooks and provider contracts: create/resume session, run/stream, steer/cancel, approvals/questions, configuration, history, terminals, tasks, MCP, skills, context, goals, models, and runtime UI slots. Put each native feature in one of these buckets:

| Native feature | Action |
| --- | --- |
| Equivalent Cradle contract exists | Project it explicitly and test the translation. |
| Cradle contract can be extended with a clear owner | Design and implement the shared contract first. |
| No sound Cradle contract | Keep it native-only and document it in `<runtime>/GAP.md`. |

Do not infer behavior from text, display labels, or loosely structured event fields. Preserve native identifiers where they are needed to issue a later action.

### Tools

Create `<runtime>/tools/identity.ts` and `<runtime>/tools/mapper.ts`. Map exact, stable native built-in names to `CradleToolKind`; use the documented qualified-name convention for MCP tools. Build all persisted tool events with `createBuiltinToolCallInputPayload()` and `createBuiltinToolCallResultPayload()`.

Do not classify tools with `includes`, regular expressions over display text, argument-shape guesses, or fall-through aliases. An unmapped native tool must be visibly unknown or have an intentional, reviewed mapping. The UI reads the canonical `kind`; it must not reconstruct provider semantics from a raw tool name.

### Models

Resolve public model metadata through Cradle's models.dev registry, including context window. For a native alias or a provider-local custom model, create or update that alias through the native typed configuration endpoint before starting the session, with provider, model, and context metadata. Fail clearly when the selected model cannot be resolved; do not silently fall back to an unrelated default model or invent a context size.

## State And Streaming Truth

Keep independent truths explicit:

- The server active-run registry owns whether a Cradle run is active and cancelable. Use it to drive the Composer stop affordance.
- Local received chunks only prove that output has rendered. Never derive lifecycle state solely from local `isStreaming` or the last SSE frame.
- Native REST session status owns provider facts such as plan mode, pending approvals/questions, task and terminal status, model settings, and usage.

Reconnect stream subscriptions with a bounded policy and rehydrate authoritative REST state after reconnect. On exhausted reconnect, emit a terminal provider failure, terminate the Cradle stream, and release the host/run lease. Never leave a run `streaming` because the provider process vanished.

Poll or refresh runtime slots while the server says `canStop`, even if chunks have paused. Make passive windows and resumed sessions hydrate native state before displaying mutable controls. Use the same authoritative state for an active run's stop button, slot visibility, and action enablement.

## Interaction Bridges

Wire native approval, question, plan, task, terminal, and cancellation events through the provider's corresponding Chat Runtime hooks. Keep UI slots declarative: slot state comes from the provider's authoritative session snapshot and actions invoke typed provider methods. Do not bolt native action URLs or untyped payloads directly into frontend components.

When native plan mode or another mode changes, publish the matching slot state and clear it when the native status clears. Ensure resumption and reconnects restore the same state, not just the text transcript.

## Verification

Run the checks that match the change, including:

1. Refresh the protocol from a real binary, then run binding-only regeneration to prove snapshots reproduce generated output.
2. Run focused tests for generated client configuration, envelope errors, host lifecycle, tool mapper, native-event mapper, reconnect exhaustion, model configuration, and provider hooks.
3. Run an opt-in real-binary smoke test in a fresh Cradle-owned temporary runtime directory. Create a native session and execute a small turn; `/auth` or process startup alone is insufficient.
4. Confirm cancellation and mode/slot state after chunks pause, a passive-window attach, provider restart, and a failed reconnect.
5. Run relevant server and web typechecks, boundary checks, and `git diff --check`.

Keep the smoke test non-destructive, opt-in for environments without the binary, and explicit about required credentials. Never call it passing the user's provider-home path.

## Delivery

Report the runtime binary/version and protocol snapshot hashes, generated-client surface, host lifecycle ownership, native capabilities projected, and entries intentionally left in `GAP.md`. List verification commands with pass/fail results and separately identify unrelated dirty files. Do not claim a provider is integrated until the real-session smoke test passes.
