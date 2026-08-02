# Plan 073: Provider first-class identity + dual-endpoint platform

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 60568afe..HEAD -- apps/server/src/modules/provider-contracts apps/server/src/modules/provider-catalog apps/server/src/modules/provider-auth apps/server/src/modules/provider-targets apps/server/src/modules/profiles apps/web/src/features/agent-management packages/db/src/schema/provider-target.ts packages/db/drizzle`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: none (complements Plan 048; does not reopen Plan 035 inventory architecture)
- **Category**: direction, tech-debt, migration
- **Planned at**: commit `60568afe`, 2026-08-01

## Why this matters

Today Cradle keys Auth UI off `providerKind`. Any `openai-compatible` row — DeepSeek, SiliconFlow, models.dev long-tail — shows Codex modes (API Key / ChatGPT / PAT / Bedrock) with "How this provider signs in to Codex." Wire shape, vendor identity, and credential acquisition are conflated. Curated vendors that document **two** base URLs (OpenAI + Anthropic) are stored as single-kind presets, so the product cannot express dual protocol honestly.

This plan delivers the full Provider platform cut (without Kimi OAuth):

1. **`providerId`** = integration identity (explicit user choice only)
2. **`providerKind`** = WireShape only
3. **Registry contributions** drive gallery + setup/detail auth
4. **First-class dual-endpoint** Providers (DeepSeek, Moonshot, …) + Universal escape hatch
5. **Explicit Bind** for legacy unbound rows
6. **Import suggest ≠ commit**

**Out of product scope (do not implement):** Kimi / Moonshot OAuth device login. Moonshot is API Key (+ dual endpoints) only.

## Current state

### Auth keyed by kind (bug)

```190:212:apps/web/src/features/agent-management/provider-setup-form.tsx
  const isCodexProvider = preset.providerKind === 'openai-compatible'
  const isClaudeProvider = preset.providerKind === 'anthropic'
  // ...
  const authModeOptions = isClaudeProvider ? CLAUDE_AUTH_MODE_OPTIONS : CODEX_AUTH_MODE_OPTIONS
```

Same pattern in `profile-detail-panel.tsx`.

### Gallery data

- Local: `PROVIDER_PRESETS` — anthropic / openai / universal (`provider-templates.ts`)
- Server: `GET /provider-presets` = models.dev + `PROVIDER_PRESET_OVERLAY`
- Overlay today marks DeepSeek / Moonshot as `openai-compatible` with a **single** `baseUrl` (`provider-preset-overlay.ts`)

Documented dual URLs (vendor docs; models.dev has only one `api` field — do not expect registry auto-discovery):

| Vendor | OpenAI-compatible | Anthropic-compatible |
|--------|-------------------|----------------------|
| DeepSeek | `https://api.deepseek.com/v1` | `https://api.deepseek.com/anthropic` |
| Moonshot (CN platform) | `https://api.moonshot.cn/v1` | `https://api.moonshot.cn/anthropic` (if undocumented on CN, use intl `https://api.moonshot.ai/anthropic` + document choice in contribution; prefer matching the openai host family the overlay already uses) |

### Persistence

`packages/db/src/schema/provider-target.ts` — has `providerKind`, **no** `provider_id`. Manual profiles are `kind = 'manual'` targets (`profiles/service.ts`).

Universal config already supports dual URLs:

```82:106:apps/server/src/modules/provider-contracts/provider-base.ts
export const UniversalProviderConfigSchema = z.object({
  // ...
  openaiBaseUrl: z.string().nullable().default(null),
  anthropicBaseUrl: z.string().nullable().default(null),
```

### Module ownership (do not invert)

| Module | Owns |
|--------|------|
| `provider-contracts` | WireShape taxonomy, config parsers |
| `provider-catalog` | presets HTTP, inventory, endpoint match, cache |
| `provider-auth` | credential lifecycle (drivers retain login/refresh) |
| `provider-targets` | target resolve, prefs, disable cascade |
| `chat-runtime-providers/*` | runtime execution |

### Hard product constraints

1. **Never silently assign `providerId`** from hostname / matchEndpoint / import auto-detect.
2. **Enumerated write paths only** (test-covered): gallery create; upsert with explicit `providerId`; Bind action; import **after** user confirms suggest.
3. Legacy `provider_id = NULL` → unbound UI = **API Key only** (no ChatGPT/PAT/Bedrock/Claude.ai).
4. Universal remains selectable first-class.
5. Provider must not own Claude turn scheduling, agent identity, secret DB, or disable cascade.
6. **No Kimi OAuth** — no new `/credentials/kimi/login` routes, no `kimi-oauth` secret kind in this plan.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Server tests (scoped) | `pnpm --filter @cradle/server exec vitest run src/modules/provider-registry src/modules/provider-catalog src/modules/provider-targets src/modules/profiles --maxWorkers=1` | pass |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Web tests | `pnpm --filter @cradle/web exec vitest run src/features/agent-management --maxWorkers=1` | pass |
| OpenAPI → clients | `pnpm --filter @cradle/web generate` | exit 0 after route/schema changes |

## Scope

**In scope**:

- `provider-contracts` — WireShape docs; contribution DTOs
- New `provider-registry` module (or STOP if boundaries reject)
- `provider-catalog` — gallery projection from registry; overlay becomes data for first-class + generic
- `provider-targets` + `profiles` — nullable `providerId`; Bind API; create/upsert
- `packages/db` — `provider_id` column + migration
- Connection test path for dual-profile providers (extend existing provider-target test, do not invent a parallel subsystem)
- `apps/web/.../agent-management` — setup, detail, bind UI, import suggest-confirm only
- Endpoint registry / overlay: dual URLs + `suggestProviders` (rename/clarify; never write identity)
- README updates for touched modules
- This plan + `plans/README.md` status

**Out of scope**:

- **Kimi / Moonshot OAuth** (rejected for this track)
- Plan 035 inventory/enrichment redesign
- Plan 048 full safe endpoint DTO publish (read/reuse matcher; do not expand 048)
- Chat-runtime turn/lifecycle changes
- External/CC Switch auto-bind
- Plugin-loaded Providers / `familyId` / `definitionVersion` upgrade wizard (optional null fields OK; no UI required)
- Auto-upgrade Generic → first-class targets

## Git workflow

- Branch: `advisor/073-provider-first-class-identity`
- Conventional commits per phase
- Do not push/PR unless instructed

---

## Phase A — Identity contract + kill kind→auth

### A0. Drift + boundaries

Run drift check. `pnpm --filter @cradle/server check:boundaries` on clean tree.

**Verify**: exit 0

### A1. Contracts vocabulary

In `provider-contracts` README + types:

- `ProviderKind` = WireShape
- `ProviderId` = string identity
- Contribution types: `ProviderIdentity`, `ProviderEndpointProfile`, `ProviderAuthMethodDeclaration`, `ProviderSetupContribution`
- Forbidden: `resolveProvider(url)` write authority; turn scheduling; secret DB

**Verify**: server typecheck

### A2. DB `provider_id`

Nullable `providerId` on `provider_targets`; drizzle migration per `packages/db/drizzle/README.md`; project through profiles list/get/upsert.

**Verify**: schema + typecheck; create without providerId → null; with `'openai'` → stored

### A3. Registry module + core contributions

`apps/server/src/modules/provider-registry/`:

| providerId | endpointProfiles | authMethods |
|------------|------------------|-------------|
| `openai` | single openai (optional empty base for native ChatGPT) | apiKey, chatgptAuthTokens, personalAccessToken, bedrockApiKey |
| `anthropic` | single anthropic | apiKey, claudeAi |
| `universal` | openai + anthropic (empty defaults) | apiKey |
| `generic` | single from catalog baseUrl | apiKey |

Register in app composition as needed. Unit tests: openai has chatgpt; no `resolveProvider`.

**Verify**: `vitest run src/modules/provider-registry`

### A4. Gallery API

Extend preset DTO with `providerId`, `tier`, `authMethods[{id,label}]`, `featured?`, and for dual providers later `endpointProfiles` (can land empty array in A for single-profile). First-class openai/anthropic/universal from registry. models.dev/overlay without override → generic apiKey-only.

`pnpm --filter @cradle/web generate`

**Verify**: presets test — deepseek still overlay/generic apiKey-only until Phase B promotes it; openai includes chatgpt method

### A5. Web create persists providerId

Setup submit sends `providerId: preset.id`. No inference from URL.

### A6. Web setup + detail contribution auth

- Options from `authMethods` / `providerId`
- Unbound (`providerId == null`) → API Key only
- Copy neutral unless providerId is openai/anthropic
- Grep: no `providerKind === 'openai-compatible'` auth branching in setup/detail

**Verify**: web typecheck + agent-management tests; rg gate

### A7. Write-path contract tests

Document allowed writers; assert no `inferProviderIdFromBaseUrl` on write paths.

---

## Phase B — Dual-endpoint first-class curated Providers

### B1. Promote overlay vendors into registry contributions

Convert curated overlay entries into first-class (or keep single-profile first-class) contributions. **Minimum dual-endpoint set (must land):**

| providerId | openaiBaseUrl | anthropicBaseUrl | auth |
|------------|---------------|------------------|------|
| `deepseek` | `https://api.deepseek.com/v1` | `https://api.deepseek.com/anthropic` | apiKey |
| `moonshot` | `https://api.moonshot.cn/v1` | `https://api.moonshot.cn/anthropic` **or** intl anthropic URL if CN path unverified — pick one, document in contribution comment, do not invent a third | apiKey |

**Single-profile first-class (apiKey / optional no key)** — promote with current overlay URLs, WireShape as today:

- `xiaomi-mimo`, `volcengine-ark-coding` (anthropic + wirePolicy bearer server-only), `zhipu`, `openrouter`, `siliconflow`, `groq`, `ollama`, `lmstudio`

Creating these profiles:

- Dual ones: `providerKind: 'universal'`, config via `openaiBaseUrl` / `anthropicBaseUrl` from endpointProfiles defaults (user may edit)
- Single openai-compatible / anthropic: keep matching WireShape + `baseUrl`
- Always set `providerId` from gallery selection

Deprecate relying on flat overlay alone for gallery identity: overlay may remain as hostname **suggest** hints + models.dev merge for model lists, but authMethods/endpoints come from registry.

**Verify**: gallery entry `deepseek` has two endpoint profiles; authMethods length 1; creating deepseek profile stores `providerId=deepseek`, `providerKind=universal`, both URLs in config

### B2. Setup UI for dual profiles

When contribution has ≥2 endpoint profiles (or providerId universal/deepseek/moonshot):

- Show OpenAI endpoint + Anthropic endpoint fields (reuse Universal UX patterns in `provider-setup-form.tsx`)
- Do **not** show Codex auth suite

Profile detail same.

**Verify**: web tests or pure helper tests for field visibility by contribution

### B3. Multi-profile connection test

Extend existing provider-target connection test so dual/universal targets can report **per-profile** results (openai side / anthropic side) without failing the whole test if only one side is probed in v1 — preferred: test both when both URLs set; surface structured status.

Find current test route under `provider-targets` (Web: `provider-connection-test.tsx`). Extend response schema minimally; update Web badges if needed.

**Verify**: server test with mock fetch for dual URLs; web typecheck

### B4. Endpoint suggest (not resolve)

If `matchProviderEndpoint` remains, add/rename a **`suggestProviders(url)`** API used only by Import UI for hints. Must not write `providerId`. Public naming must not be `resolveProvider`.

**Verify**: unit test suggest returns candidates; no write helper calls it

---

## Phase C — Explicit Bind for unbound targets

### C1. Bind API

`POST /profiles/:id/bind-provider` or `PATCH` with `{ providerId }` only when:

- Target is manual
- Client sends explicit providerId from a picker (list from registry gallery ids)
- Server does **not** validate by matching current baseUrl to force a choice — optional warning suggest in response is OK; rejection based on hostname is not OK

Applying bind may **offer** to apply endpoint defaults from contribution if user also sends `applyEndpointDefaults: true` (explicit). Default false = only set providerId (and thus unlock brand auth UI / dual fields without rewriting URLs).

**Verify**: bind without apply leaves URLs; bind with apply fills deepseek defaults; cannot bind via server-side hostname guess endpoint

### C2. Web Bind UI

On profile detail when `providerId == null`: callout + button "Bind to provider template…" → picker (registry list) → confirm. No auto-open, no default selection of "best match".

**Verify**: manual QA notes in plan done criteria; optional pure test for picker data source

---

## Phase D — Import confirm-only

### D1. Import dialog

When parser finds a URL and `suggestProviders` returns candidates:

- Show suggestion chips
- User must select one (or skip / use Universal) before create sets `providerId`
- Skipping → `providerId` null or `universal` only if user picked Universal card — never silent DeepSeek

**Verify**: import flow unit/integration test: suggest present but create without selection → providerId null

---

## Test plan (all phases)

1. Registry: openai ⊃ chatgpt; deepseek dual profiles; moonshot apiKey only (no oauth method id)
2. Persistence: explicit providerId; null unbound; no URL inference
3. Setup/detail: kind no longer drives Codex options; unbound apiKey-only; deepseek dual fields
4. Connection test dual sides (Phase B)
5. Bind explicit only (Phase C)
6. Import suggest does not write (Phase D)
7. Grep: no kimi oauth routes/secret kinds added

Model after: `provider-presets.test.ts`, `import-provider-parser.test.ts`

## Done criteria

- [ ] Server + web typecheck exit 0
- [ ] Scoped vitest suites above pass
- [ ] `provider_id` nullable migrated
- [ ] Gallery exposes authMethods + endpointProfiles; web client regenerated
- [ ] kind→auth hardcoding removed from setup + detail
- [ ] DeepSeek + Moonshot first-class dual (or documented single anthropic URL choice) with apiKey only
- [ ] Remaining overlay vendors first-class single-profile or generic with apiKey-only
- [ ] Unbound = apiKey only; Bind UI + API explicit
- [ ] Import suggest cannot commit providerId without selection
- [ ] **No** Kimi OAuth implementation
- [ ] No silent providerId backfill
- [ ] `plans/README.md` status → DONE

## STOP conditions

- Boundaries reject registry module
- Drizzle migration conventions unclear
- CN Moonshot anthropic URL cannot be confirmed and intl URL would change product region assumptions — STOP and report with evidence; do not ship a guessed third host without documenting the choice in the contribution
- Pressure to add Kimi OAuth mid-flight — refuse; out of scope
- Pressure to auto-bind from hostname — refuse
- Dual connection test requires rewriting Plan 035 inventory — STOP

## Maintenance notes

**Reviewer focus:** every providerId write; DeepSeek no longer shows Codex auth; unbound behavior; Bind defaults flag; no oauth.

**Rejected for this track:**

- Kimi / Moonshot OAuth device login (product: not needed now)
- Silent matchEndpoint identity migration

**Optional later (not blocking DONE):**

- `familyId` brand grouping
- Plugin Provider registration
- `definitionVersion` upgrade UX
- Plan 048 projecting from same registry
- Regional Moonshot AI vs CN as separate providerIds if product wants two cards
