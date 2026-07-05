# Plan 003 — Require auth on relay-tunneled traffic

> **Executor instructions**: Follow step by step; verify each step. Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/relay-transport apps/server/src/app.ts` — on any change, compare excerpts to live code; mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — must not break legitimate paired remote-host workflows.
- **Depends on**: plans/002-http-ws-auth-plugin.md
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

The relay host-connector opens a raw TCP socket to the local server port for every tunneled stream and forwards bytes verbatim. Because the local HTTP API has no auth (addressed by plan 002 but default-off), a paired remote controller gets byte-for-byte access to secrets, filesystem, terminals, git, and chat — the same as a local client. This plan forces relay-tunneled requests through the plan-002 auth boundary with a relay-scoped token, so enrollment ≠ unrestricted API access.

## Current state

- `apps/server/src/modules/relay-transport/host-connector.ts:256-275` — `openLocalStream` connects to the local server with no auth layer:

```256:275:apps/server/src/modules/relay-transport/host-connector.ts
  private openLocalStream(streamId: string): void {
    const session = this.session
    if (!session) {
      return
    }
    const socket = net.connect({ host: this.config.localServerHost, port: this.config.localServerPort })
    this.streams.set(streamId, { socket, streamId })

    socket.on('data', (chunk: Buffer) => {
      session.writeStreamData(streamId, new Uint8Array(chunk))
    })
    ...
  }
```

- `apps/server/src/app.ts:229-233` — the connector is wired to `127.0.0.1` + the server's own port:

```229:233:apps/server/src/app.ts
  const serverConfig = getServerConfig()
  const hostConnector = initHostConnectorService({
    localServerHost: '127.0.0.1',
    localServerPort: serverConfig.port,
  })
```

- Enrollment/token model lives in `apps/server/src/modules/relay-transport/host-enrollment-service.ts` and `model.ts`.
- After plan 002, `verifyRequestToken` and a config auth token exist in `apps/server/src/http/auth.ts`.

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |

## Scope

**In scope**:
- `apps/server/src/modules/relay-transport/host-connector.ts` — inject a relay-scoped auth token into forwarded HTTP requests, OR mark the tunneled connection as requiring auth so the plan-002 boundary rejects unauthenticated tunneled requests.
- `apps/server/src/modules/relay-transport/host-enrollment-service.ts` — mint/store a per-enrollment relay token.
- `apps/server/src/http/auth.ts` — accept relay-scoped tokens as valid (extend the multi-token acceptance noted in plan 002 maintenance).
- Corresponding `*.test.ts`.

**Out of scope**:
- The base auth plugin (plan 002).
- Pairing-code exposure (plan 006 handles that).

## Steps

### Step 1: Mint a relay-scoped token per enrollment
In `host-enrollment-service.ts`, generate a random token when an enrollment is created; store it (encrypted, following the secrets pattern) alongside the enrollment. Expose a getter used by the host-connector.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Inject the token on tunneled requests
Because `openLocalStream` is a raw byte pipe (it can't easily add HTTP headers), prefer binding relay traffic to a distinct internal path or injecting an `x-cradle-relay-token` header at the HTTP parse boundary. If raw-byte injection is infeasible, STOP and report — a header-rewriting proxy or a dedicated authenticated local listener is the correct design and should be confirmed before implementing.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 3: Accept relay tokens in the auth boundary
Extend `verifyRequestToken` (plan 002) to accept any active relay-enrollment token in addition to the primary auth token, scoping which routes relay tokens may reach if a scope model is desired.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 4: Tests
Cover: tunneled request without relay token is rejected once `authRequired`; tunneled request with a valid enrollment token is accepted; revoked enrollment token is rejected.

**Verify**: `pnpm --filter @cradle/server test` → all pass

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; new relay-auth tests pass
- [ ] Unauthenticated tunneled traffic is rejected when auth is enabled
- [ ] `plans/README.md` status row updated

## STOP conditions

- Raw-byte stream forwarding cannot carry auth context and no header-rewrite/dedicated-listener path is obvious — STOP and report; this needs a design decision.
- Changing the token model would break the existing pairing handshake — STOP and report the handshake contract.

## Maintenance notes

- Relay tokens are high-value credentials; document rotation-on-compromise (ties into plan 007 secrets rotation).
- Reviewer must confirm no path lets a relay client reach routes it shouldn't (secrets, generic shell) even with a valid enrollment token — consider scoping.
