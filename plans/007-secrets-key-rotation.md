# Plan 007 — Add key versioning + rotation path for stored secrets

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/modules/secrets` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — re-encryption migration touches every credential row; a bug can lock users out of their keys.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

All stored credentials (provider API keys, relay host/signing private keys, ChatGPT auth blobs) are AES-256-GCM encrypted with a key derived from a single env var `CRADLE_CREDENTIAL_SECRET`. Compromise of that env var decrypts everything, and there is no key-version field or documented rotation workflow — rotating the secret today would silently make all existing ciphertext undecryptable. This plan adds a key-version column and a re-encryption path so rotation becomes possible.

## Current state

- `apps/server/src/modules/secrets/service.ts:50-88` — key derivation and cipher:

```58:73:apps/server/src/modules/secrets/service.ts
function getKey(): Buffer {
  const secret = getCredentialSecret()
  if (!secret) {
    throw new Error('CRADLE_CREDENTIAL_SECRET is not configured')
  }
  return createHash('sha256').update(secret).digest()
}

function encrypt(plainText: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`
}
```

- `apps/server/src/modules/secrets/service.ts:118-131` — `saveSecret` stores ciphertext in `agentCredentials.encryptedSecret` (SQLite via drizzle).
- Relay host private keys are stored the same way (`relay-transport/host-enrollment-service.ts:105-119` per audit).
- Schema lives in `@cradle/db` (drizzle). **Schema changes require care** (see AGENTS.md rule: don't casually modify DB schema) — adding a nullable `keyVersion` column is the minimal change.

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass |
| Migration | `pnpm drizzle-kit generate` (root)       | generates migration |

## Scope

**In scope**:
- `packages/db` schema — add nullable `keyVersion` (integer, default 1) to the credentials table + a drizzle migration.
- `apps/server/src/modules/secrets/service.ts` — embed key version in the ciphertext envelope (prefix), decrypt using the row's version, add `rotateEncryptionKey(oldSecret, newSecret)` that re-encrypts all rows in one transaction.
- `secrets/service.test.ts`.

**Out of scope**:
- Moving the master key into OS keychain/KMS — that is a larger follow-up; note it in maintenance. This plan only makes rotation *possible*.

## Steps

### Step 1: Schema — add key version
Add nullable `keyVersion` to the credentials schema in `packages/db`; generate the migration. Existing rows default to version 1.

**Verify**: `pnpm drizzle-kit generate` produces a migration; `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Versioned envelope
Change `encrypt`/`decrypt` to prefix a version tag (e.g. `v1:iv:payload:tag`); `decrypt` dispatches on the version. Keep backward compatibility: ciphertext without a version prefix is treated as v1.

**Verify**: `pnpm --filter @cradle/server test secrets` → pass (existing ciphertext still decrypts)

### Step 3: Rotation routine
Add `rotateEncryptionKey({ from, to })` that, within a single `db().transaction`, decrypts each row with the old key and re-encrypts with the new key + bumped version. Expose via an admin-only route or CLI command (auth-gated).

**Verify**: `pnpm --filter @cradle/server test secrets` → pass

### Step 4: Tests
Round-trip encrypt/decrypt across versions; rotation re-encrypts all rows and old ciphertext no longer decrypts with the new-only key; transaction rolls back on a mid-rotation failure.

**Verify**: `pnpm --filter @cradle/server test secrets` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; rotation + versioned-decrypt tests pass
- [ ] A migration file is generated and committed
- [ ] `plans/README.md` status row updated

## STOP conditions

- The DB schema change would require touching many unrelated tables or a destructive migration — STOP and report.
- Existing production ciphertext format differs from the `iv:payload:tag` excerpt — STOP and report the actual format.

## Maintenance notes

- Follow-up (deferred): move the master key to OS keychain/KMS; treat relay signing keys as requiring rotation on pairing compromise.
- Reviewer: scrutinize the transaction boundary in rotation — a partial rotation must not leave mixed-key rows without a recorded version.
