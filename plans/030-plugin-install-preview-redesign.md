# Plan 030 — Overturn the plugin import dialog: paste → preview → confirm → install

> **Executor instructions**: Backend + Frontend. Supersedes the frontend-only scope of Plan 029 (which produced the current `plugins-add-dialog.tsx`). 029 kept a collapsed `ref`/`subPath`/`label` "Advanced" form and shipped a read-only post-install result list — that is the "拉完直接给到" UX being overturned here. Verify each step. Update `plans/README.md`.

## Status
- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM — adds one stateless backend endpoint (no DB writes, no activation) + rewrites the dialog flow. Cache reuse relies on the existing hash-based `sourceCacheKey` (already independent of `source.id`).
- **Depends on**: 027 (`/plugins/sources` API), 029 (parser + dialog scaffolding already shipped)
- **Category**: UX / consumer-facing
- **Planned at**: 2026-07-06

## Why this matters (the pain being overturned)

Plan 029's executed result — `apps/web/src/features/settings/plugins-add-dialog.tsx` — is still a developer form wearing a C-end costume:

1. **"拉完直接给到"** (the core complaint). Paste → `POST /plugins/sources` installs immediately → a **read-only** `ResultStep` lists what got installed. The user never sees *what will be installed* before it lands. No confirm gate, no selection, no chance to bail. The rich `discoveredPlugins` metadata arrives only *after* the side effect.
2. **`ref` / `subPath` / `label` still exposed** in a collapsed "Advanced" disclosure. These are Git/npm internals; a consumer has no mental model for "subpath". The disclosure's existence alone signals "you might need to understand this."
3. **Zero trust signal before install.** C-end users care most about "who made this / is it safe". `source.trusted` and `declaredPermissions` exist in the descriptor but are never shown until after install — and 029's planned trust-on-enable consent was never implemented (current toggle is a direct `PATCH`).
4. **No selection.** A source can fan out to multiple plugins; the user gets all of them, no checkboxes.
5. **Raw error surface.** `ErrorStep` strings up the backend error (often JSON) in destructive red.

The fix is the flow 029 explicitly scoped out: a real **paste → preview → confirm → install** pipeline, backed by a new stateless preview endpoint that reuses the existing download+discovery path but writes nothing to the DB and activates nothing.

## Backend: new `POST /plugins/sources/preview` endpoint

Stateless: downloads to the existing hash-keyed cache, discovers packages, evaluates trust, returns a preview — **no DB row, no runtime registration, no activation**. The cache is reused by the subsequent real install so the tarball is fetched exactly once.

### Why cache reuse works
- `sourceCacheKey(source)` (in `apps/server/src/plugins/source-installer.ts`) hashes `{kind, location, ref, subPath}` — **already independent of `source.id`**.
- `resolvePluginSourceDirectory(source)` checks `cacheDirForSource(source)/packages` (and `/content`) and returns immediately if present — only downloads on miss.
- So: preview builds a throwaway `PluginSource`-shaped object (id `preview:<hash>`, no DB write), calls `resolvePluginSourceDirectory` → downloads to the hash dir. The later real `createSource` builds a real DB row whose `{kind,location,ref,subPath}` produce the **same hash** → `resolvePluginSourceDirectory` hits the cache → no second fetch.

### `service.ts` — new `previewSource(input)`
```
export interface PluginPreviewItem {
  name: string
  version: string
  displayName: string
  description: string | null
  iconAvailable: boolean              // manifest.icon present? (icon bytes served only after install)
  trusted: boolean
  trustReason: string | null
  declaredPermissions: PluginDeclaredPermissionView[]
  warnings: string[]
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
}

export interface PluginSourcePreview {
  source: { kind: PluginSource['kind'], location: string, ref: string | null, subPath: string | null }
  plugins: PluginPreviewItem[]
  warnings: string[]                  // e.g. "no plugins found at this source"
}

export async function previewSource(input: AddPluginSourceInput): Promise<PluginSourcePreview>
```
Implementation:
1. Build a throwaway `PluginSource` object: `{ id: 'preview:' + sourceCacheKey({...}), kind, location, ref, subPath, label: null, addedReason: 'preview', createdAt: 0, updatedAt: 0 }`. Do **not** call `addPluginSource` (no DB write).
2. `const pluginsDir = await resolvePluginSourceDirectory(tempSource)` — downloads to cache on first call, reuses on repeat.
3. `const packages = await discoverPluginPackages(pluginsDir)` (already pure: reads dirs, parses `package.json`).
4. For each `DiscoveredPluginPackage`: classify source + `evaluatePluginSourceTrust({ pluginName, source, relayHostExposed: readRelayHostExposure() })` → map to `PluginPreviewItem` (reuse `toDeclaredPermissionView` from `service.ts`). Invalid packages (no manifest) surface as a `warnings` entry, not a row.
5. Return `{ source, plugins, warnings }`. Never call `registerPluginDescriptor` / `prepareAndActivateManifests` / `setPluginActivationPolicy`.

### `discoverAndActivateSource` — switch `refresh` → `resolve` (one-line, cache reuse)
In `apps/server/src/plugins/loader.ts:515`, change `refreshPluginSourceDirectory(source)` → `resolvePluginSourceDirectory(source)` so the real install reuses the preview's cached download instead of `rm`+re-fetching.

**Trade-off**: "Add source" no longer force-refreshes a stale cache. Acceptable: (a) the UI already has a per-source Refresh action; (b) the preview-then-install flow is seconds apart, so staleness is moot in the C-end path; (b) CLI `cradle plugin source add` callers who need a forced refresh can use the existing refresh endpoint. Note this in `plans/README.md` and the maintenance section.

### `index.ts` — register the route
```
.post('/sources/preview', ({ body }) => Plugins.previewSource(body), {
  detail: { summary: 'Preview plugin source (no install)' },
  body: PluginsModel.previewPluginSourceBody,
  response: { 200: PluginsModel.pluginSourcePreview },
})
```

### `model.ts` — schemas
- `previewPluginSourceBody = t.Object({ kind: t.Union([t.Literal('git'), t.Literal('npm')]), location: t.String({ minLength: 1 }), ref: t.Optional(t.Nullable(t.String())), subPath: t.Optional(t.Nullable(t.String())) })` — same shape as `addPluginSourceBody` minus `label`/`addedReason`.
- `pluginSourcePreview = t.Object({ source: ..., plugins: t.Array(pluginPreviewItem), warnings: t.Array(t.String()) })` with `pluginPreviewItem` mirroring the TS interface above.
- Export both on `PluginsModel`.

### Regenerate API client
Run the OpenAPI codegen so `apps/web/src/api-gen/` gets `postPluginsSourcesPreview` + `PostPluginsSourcesPreviewResponse` (follow the repo's existing gen command — confirm via `package.json` scripts or `cradle man` before inventing one).

## Frontend: rewrite `plugins-add-dialog.tsx` as a 4-step flow

Same file, same `AddPluginDialog` export, same props. Internals become a small state machine. Container widens to `max-w-xl` (preview list needs room). No `ref`/`subPath`/`label` anywhere — delete `AdvancedSection`, `TextField`, `EMPTY_ADVANCED`, `AdvancedFields`.

### State machine
```
type Step = 'paste' | 'previewing' | 'review' | 'installing' | 'done' | 'error'
```

**Step `paste` — smart input + live recognition**
- One `Input` (autofocus, spellcheck off). Placeholder: `plugins.add.inputPlaceholder` = "粘贴 cradle:// 链接、GitHub 仓库地址或 npm 包名".
- Below the input: a **live recognition chip** rendered from `parsePluginSourceInput(input)` — type badge (`GitHub 仓库` / `npm 包` / `cradle 链接`) + normalized location (`owner/repo` / `@scope/pkg`). Shows only when `parsed !== null`. Replaces the old `hint` paragraph as the primary feedback.
- Below that: three clickable example chips ("试试：GitHub 仓库 / npm 包 / cradle 链接") that expand one-line samples — gives C-end users the "what can I paste" discoverability a bare placeholder never provides.
- Local-path paste → show `plugins.add.localPathHint` (points to CLI), keep submit disabled.
- Unrecognized paste → `plugins.add.invalidHint`, submit disabled.
- Primary button: `plugins.add.preview` = "查看将安装的内容". Disabled until `parsed` is valid.

**Step `previewing` — resolving the source**
- `useMutation` calling `postPluginsSourcesPreview({ body })` with `{ kind, location, ref, subPath }` from the parser.
- Body: spinner + `plugins.add.resolving` = "正在解析来源…". This is the network fetch; can take a few seconds for large repos.

**Step `review` — the confirm gate (the heart of the overturn)**
- Source header card: type + location + ref (if any) + a "not yet installed" tag.
- `plugins.length === 0` → empty state with `plugins.preview.empty` = "在这个来源里没找到任何 Cradle 插件" + "换个链接" button → back to `paste`.
- Otherwise: a list of `PreviewPluginRow` — each row:
  - Icon (first-letter fallback — real icon only after install, since `readPluginIcon` needs a registered `routeSegment`).
  - `displayName` · `v{version}` · provenance.
  - `description` (line-clamp-2).
  - **Trust line**: if `trusted` → muted "✓ 已信任"; else amber "⚠ 未信任 — 启用前需确认" with `trustReason` in a tooltip.
  - **Permissions**: if `declaredPermissions.length > 0`, a "申请 N 项权限" popover listing each `label`/`description`; else omit.
  - `warnings` (per-plugin) shown inline, muted.
  - `Checkbox` (default checked). When >1 plugin, header shows "全选 / 取消全选".
- Footer: secondary "返回" (→ `paste`) + primary `plugins.add.installN` = "安装 {{count}} 个插件" (count = selected). Disabled when count = 0.
- This is where the user *sees what will land and chooses* — the exact step 029 skipped.

**Step `installing` — progress**
- `useMutation` calling `postPluginsSources({ body })` with the same `{ kind, location, ref, subPath }` + `addedReason: 'Added via Settings preview flow.'` + `label: null`.
- Body: spinner + `plugins.add.installing` = "正在安装…". (The endpoint is non-streaming, so no per-plugin live progress — keep it honest with a single indeterminate state.)
- On success → `done`. On error → `error`.

**Step `done` — result + control**
- Reuse the existing `DiscoveredPluginRow` (icon now resolves via the registered `routeSegment`) but make it **actionable**, not read-only: each row gets an `Enable` button calling `patchPluginsByRouteSegmentEnabled` (with trust-on-enable consent for untrusted externals — see below). Already-enabled plugins show a check.
- Top line: `plugins.add.resultHint` = "已添加。默认关闭，启用后开始使用。"
- Secondary "撤销，移除此来源" button → `deletePluginsSourcesById` + `unsyncDesktopSource` (the safety net for "I installed the wrong thing"). Confirms if the source fans out to >1 plugin.
- Primary "完成" → close + reset.
- Invalidate `['plugins','list']` and `['plugins','sources']` on success (already done today).

**Step `error`**
- Plain-language message (map common backend errors: 404 repo → "找不到这个仓库", network → "网络问题，检查连接后重试", no plugins → "来源里没有 Cradle 插件"). Fall back to a trimmed backend message only if unrecognized.
- "重试" → back to `review` (re-call preview, since the install input is unchanged). "取消" → close.

### Trust-on-enable consent (implement what 029 planned but didn't)
Extract a small `TrustConsentDialog` (sibling file `plugins-trust-consent-dialog.tsx`):
- Triggered before any `PATCH …/enabled` when the target plugin's `source.kind === 'externalLocal' && !source.trusted`.
- Fetches `GET /plugins/:routeSegment` for full `declaredPermissions`, lists them in plain language, confirms → proceeds with the PATCH. Cancel = no toggle.
- Used both from the `done` step's per-row Enable and from the main `PluginCard` toggle (so the settings page itself finally gets the consent gate 029 specified).
- Built on `alert-dialog.tsx` from the design system.

### Desktop bridge
Keep `syncDesktopSource(sourceId)` on install success and `unsyncDesktopSource(identity)` on uninstall — unchanged from today, guarded on `window.cradle`.

## Locales

Edit `apps/web/src/locales/default/settings.ts` (type-checked source of truth) + `zh-CN/settings.json` + `en-US/settings.json`.

**Remove** (Advanced form is gone): `plugins.add.advancedToggle`, `plugins.add.ref`, `plugins.add.refPlaceholder`, `plugins.add.subPath`, `plugins.add.subPathPlaceholder`, `plugins.add.label`, `plugins.add.labelPlaceholder`.

**Repurpose / rewrite**: `plugins.add.inputLabel` → "插件来源"; `plugins.add.inputPlaceholder` → "粘贴 cradle:// 链接、GitHub 仓库地址或 npm 包名"; `plugins.add.description` → "粘贴一个插件来源，我们会先展示它包含哪些插件，确认后再安装。"

**Add**:
- `plugins.add.preview` = "查看将安装的内容"
- `plugins.add.resolving` = "正在解析来源…"
- `plugins.add.installN` = "安装 {{count}} 个插件"
- `plugins.add.recognition.github` = "GitHub 仓库"
- `plugins.add.recognition.npm` = "npm 包"
- `plugins.add.recognition.cradle` = "cradle 链接"
- `plugins.add.example.github` / `.npm` / `.cradle` = sample strings for the clickable chips
- `plugins.preview.empty` = "在这个来源里没找到任何 Cradle 插件"
- `plugins.preview.trusted` = "已信任"
- `plugins.preview.untrusted` = "未信任"
- `plugins.preview.permissions` = "{{count}} 项权限"
- `plugins.preview.select-all` / `plugins.preview.selected-n`
- `plugins.add.undo` = "撤销，移除此来源"
- `plugins.add.undoConfirm` = "这将移除来自 {{source}} 的 {{count}} 个插件。"
- `plugins.add.error.repoNotFound` / `.network` / `.noPlugins` (plain-language error maps)
- `plugins.trust.title` / `.body` / `.permissions` / `.confirm` / `.cancel` (for `TrustConsentDialog`)

Keep existing `plugins.sources.toast.*` and `plugins.add.toast.*` keys.

## Files

| File | Change |
|---|---|
| `apps/server/src/modules/plugins/service.ts` | Add `previewSource` + `PluginSourcePreview`/`PluginPreviewItem` interfaces |
| `apps/server/src/modules/plugins/model.ts` | Add `previewPluginSourceBody` + `pluginSourcePreview` + `pluginPreviewItem` schemas; export on `PluginsModel` |
| `apps/server/src/modules/plugins/index.ts` | Register `POST /sources/preview` route |
| `apps/server/src/plugins/loader.ts` | `discoverAndActivateSource`: `refreshPluginSourceDirectory` → `resolvePluginSourceDirectory` (cache reuse) |
| `apps/web/src/api-gen/` | Regenerate client (`postPluginsSourcesPreview` + types) |
| `apps/web/src/features/settings/plugins-add-dialog.tsx` | Rewrite as 4-step state machine; delete `AdvancedSection`/`TextField`; add live recognition + review + undo |
| `apps/web/src/features/settings/plugins-trust-consent-dialog.tsx` | **New** — trust-on-enable consent (planned by 029, never built) |
| `apps/web/src/features/settings/plugins-settings.tsx` | Wire `TrustConsentDialog` into `PluginCard` toggle for untrusted externals |
| `apps/web/src/locales/default/settings.ts` | Key changes per above |
| `apps/web/src/locales/zh-CN/settings.json` | zh-CN copy |
| `apps/web/src/locales/en-US/settings.json` | en-US copy |
| `plans/README.md` | Status row for 030; note 029 superseded |

## Steps

### Step 1 — Backend preview endpoint
Add `previewSource` in `service.ts` (throwaway `PluginSource`, `resolvePluginSourceDirectory` + `discoverPluginPackages` + `evaluatePluginSourceTrust`, no registration). Add schemas in `model.ts`. Register route in `index.ts`. Switch `loader.ts` to `resolvePluginSourceDirectory`.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0. Manual `curl -X POST …/plugins/sources/preview -d '{"kind":"git","location":"<known-good-repo>"}'` returns the preview JSON and does **not** create a row (verify `GET /plugins/sources` unchanged).

### Step 2 — Regenerate API client
Run the repo's OpenAPI gen command (confirm exact script from `package.json` / `cradle man` — do not invent).

**Verify**: `postPluginsSourcesPreview` exists in `apps/web/src/api-gen/sdk.gen.ts`; `PostPluginsSourcesPreviewResponse` in `types.gen.ts`.

### Step 3 — Locales
Apply the key add/remove/rewrite list to all three locale files.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0 (the type-checked `default/settings.ts` catches missing/extra keys).

### Step 4 — Frontend dialog rewrite
Implement the 4-step state machine + live recognition + review list + undo. Delete the Advanced section entirely.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0.

### Step 5 — Trust consent dialog
Build `plugins-trust-consent-dialog.tsx`; wire into both the `done`-step Enable and the `PluginCard` toggle.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0.

### Step 6 — Smoke + suite
- `pnpm --filter @cradle/web test` → exit 0.
- `pnpm --filter @cradle/server test` → exit 0.
- Manual: paste GitHub URL → see recognition chip → "查看将安装的内容" → review list with permissions/trust → select subset → install → done with per-row Enable (consent for untrusted) → undo removes source. Verify cache reuse: a second add of the same source should not re-download (server logs).

## Done criteria
- [ ] No `ref`/`subPath`/`label` fields anywhere in the Add dialog (Advanced section deleted, not just collapsed).
- [ ] Paste → live recognition chip before any network call.
- [ ] "查看将安装的内容" opens a review step showing each plugin's name/version/description/**permissions**/**trust state** with checkboxes — before install.
- [ ] Install reuses the preview's cached download (no second fetch of the same tarball).
- [ ] `done` step offers per-plugin Enable (with trust consent for untrusted externals) and an undo that removes the source.
- [ ] Enabling an untrusted `externalLocal` plugin from the settings page also goes through the consent dialog.
- [ ] Plain-language error messages; no raw JSON shown to the user.
- [ ] `POST /plugins/sources/preview` writes nothing to the DB and activates nothing (verified: `GET /plugins/sources` unchanged after a preview-only call).
- [ ] `pnpm --filter @cradle/web typecheck` / `test` and `pnpm --filter @cradle/server typecheck` / `test` exit 0.
- [ ] `plans/README.md` status row updated; 029 marked superseded by 030.

## STOP conditions
- The OpenAPI gen command isn't discoverable from `package.json` or `cradle man` — STOP and ask; don't invent a script.
- `evaluatePluginSourceTrust` signature or `PluginSource` shape has drifted from what this plan assumes (read at implementation time) — STOP and reconcile the call site rather than casting.
- `resolvePluginSourceDirectory` no longer checks cache before downloading (refactored since this plan) — STOP; the cache-reuse premise is broken and the preview would double-fetch.

## Maintenance notes
- "Add source" no longer force-refreshes a stale cache (switched `refresh` → `resolve`). Operators who need a forced refresh use the existing per-source Refresh action or the CLI. This trades a rarely-needed implicit refresh for single-fetch preview→install.
- Preview does not return icon bytes (icons are served by `GET /plugins/:routeSegment/icon`, which requires a registered routeSegment the preview doesn't create). The review list uses first-letter fallbacks; real icons appear on the `done` step after registration. If preview-time icons become important later, add a `preview/:token/icon` endpoint keyed by packageDir — separate plan.
- `localPath` remains CLI-only (unchanged from 029).
- The deep-link (`cradle://plugins/install`) primary install path is untouched; this plan only redesigns the in-Settings manual flow.

## Reconciliation — 2026-07-15

Plan 047 confirmed that the preview/cache foundation described here already exists: plugin source preview/install resolves through the hash-keyed cache, and GitHub archive transfer now runs through the server Download Center rather than an in-memory `arrayBuffer` path. The preview remains stateless: Download Center owns durable redacted transfer state, while plugin source ownership retains discovery, trust evaluation, cache publication, and extraction. This is foundation reconciliation only; it does not mark this plan's consumer-flow criteria complete.
