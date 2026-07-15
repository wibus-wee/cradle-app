# Plan 031 — Plugin Center: marketplace browse/search + import (supersedes 030's dialog form)

> **Executor instructions**: Backend + Frontend. Extends Plan 030: **keeps** 030's backend `POST /plugins/sources/preview` endpoint, trust-on-enable consent, and undo flow verbatim. **Replaces** 030's Dialog form with a top-level `/plugins` route holding three tabs (Marketplace / Installed / Import). Adds a static marketplace index + a `plugin-marketplace` server module modeled on the existing `provider-catalog`. Verify each step. Update `plans/README.md`.

## Status
- **Priority**: P1
- **Effort**: XL
- **Risk**: MEDIUM — new top-level route + new server module, but the marketplace module closely mirrors the shipped `provider-catalog` (fetch + singleton cache + stale flag), and the install path reuses 030's preview endpoint.
- **Depends on**: 027 (`/plugins/sources` API), 030 (preview endpoint + trust consent — implement together with this plan)
- **Category**: UX / consumer-facing
- **Planned at**: 2026-07-06

## Why this matters

Plan 030 fixed the "拉完直接给到" problem for the *manual paste* path — but only that path. The user wants a real **Plugin Center**: a browseable, searchable marketplace where plugins are discovered, not just pasted. That requires two things 030 deliberately scoped out:

1. **A marketplace data source.** None exists today — `marketplace` in the codebase is a *trust* concept (install receipts, `CRADLE_MARKETPLACE_PLUGINS_DIR`), not a browse catalog. There is no remote index, no list/search endpoint.
2. **A center-shaped surface.** A Dialog can't host browse + search + manage. It needs a top-level route with tabs.

This plan adds both, and folds 030's paste→preview→confirm→install flow in as the **Import** tab.

## Architecture decisions (confirmed with user)

- **Marketplace data source**: static `marketplace.json` hosted in-repo (served via GitHub raw). Curated, PR-maintained. Modeled on `provider-catalog` (which fetches `models.dev`).
- **Surface**: independent top-level route `/plugins`, reached from the settings sidebar (replaces the current settings-overlay `plugins` section).

---

## Backend

### A. Static index — `marketplace.json` (repo root)

A curated catalog. Schema (versioned):

```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-06T12:00:00Z",
  "plugins": [
    {
      "id": "browser-use",                 // stable slug, unique in catalog
      "displayName": "Browser Use",
      "description": "Browser automation MCP server + skill.",
      "icon": "https://raw.githubusercontent.com/wibus-wee/cradle-app/main/plugins/browser-use/assets/icon.svg",
      "category": "automation",            // automation | mcp | integration | skill | dev
      "tags": ["browser", "mcp"],
      "author": { "name": "Cradle", "url": "https://github.com/wibus-wee" },
      "homepage": "https://github.com/wibus-wee/cradle-app",
      "bundled": true,                     // true → ships in-app; card shows "内置" + Enable, no install
      "source": {                          // absent when bundled:true (no install needed)
        "kind": "git",
        "location": "owner/repo",
        "ref": "main",
        "subPath": "plugins/foo"
      },
      "featured": true                     // surfaces in the "精选" row
    }
  ]
}
```

- **Seed content**: the 6 bundled plugins with `bundled: true` + `featured: true` (so the marketplace is non-empty on day 1) and any known community plugins as installable entries. Bundled entries carry no `source` (they're already on disk; the card offers Enable, not Install).
- **Hosting**: `https://raw.githubusercontent.com/wibus-wee/cradle-app/main/marketplace.json`. Configurable via `CRADLE_PLUGIN_MARKETPLACE_URL` env (override for mirrors/self-host). Default to the GitHub raw URL.

### B. New server module `apps/server/src/modules/plugin-marketplace/`

Mirror `provider-catalog`'s shape (fetch → singleton cache → stale flag). Single global catalog (not per-target).

**`catalog.ts`**
- `MARKETPLACE_TTL_MS` (default 60 min).
- Singleton `{ entries: MarketplaceEntry[], fetchedAt: number, source: string } | null`.
- `fetchMarketplace(force?: boolean)`: if cache fresh and not forced, return it; else `fetch(CRADLE_PLUGIN_MARKETPLACE_URL ?? DEFAULT)`, parse with zod, update singleton, return. On fetch failure with a stale cache present, return stale + `stale:true`; on failure with no cache, throw (caller maps to 503).
- Reuse the project's existing fetch/error patterns (see `provider-catalog/catalog.ts` `fetchModelsPayload`).

**`service.ts`**
- `listMarketplace(): Promise<{ plugins: MarketplaceEntry[], stale: boolean, fetchedAt: number | null }>`
- `refreshMarketplace(): Promise<{ plugins: MarketplaceEntry[], stale: boolean, fetchedAt: number }>` — forces `fetchMarketplace(true)`.

**`model.ts`** — Elysia `t.Object` schemas: `marketplaceEntry`, `marketplaceResponse` (`{ plugins: t.Array(marketplaceEntry), stale: t.Boolean(), fetchedAt: t.Nullable(t.Number()) }`). Export on a `MarketplaceModel`.

**`index.ts`** — routes mounted under the existing `/plugins` prefix (add to `apps/server/src/modules/plugins/index.ts`, or a sibling Elysia instance merged alongside):
```
.get('/marketplace', () => Marketplace.listMarketplace(), {
  detail: { summary: 'List marketplace plugin catalog' },
  response: { 200: MarketplaceModel.marketplaceResponse },
})
.post('/marketplace/refresh', () => Marketplace.refreshMarketplace(), {
  detail: { summary: 'Force-refresh marketplace catalog' },
  response: { 200: MarketplaceModel.marketplaceResponse },
})
```
Note: the catalog is small (tens of entries). **Search/filter/category are client-side** — no server search endpoint (unlike `provider-catalog`'s `model-search`, which delegates to models.dev). This keeps the module minimal.

### C. Preview + install (from Plan 030, unchanged)
Implement 030's `POST /plugins/sources/preview` (stateless: download to hash cache, discover, evaluate trust, return — no DB, no activation) and the `discoverAndActivateSource` `refresh→resolve` cache-reuse switch. The Marketplace tab's Install button calls preview with the entry's `source`, then review, then `POST /plugins/sources`. See Plan 030 for full spec; do not re-derive here.

---

## Frontend

### A. Top-level route `/plugins` + surface

**Route file** `apps/web/src/routes/plugins/index.tsx`:
```tsx
export const Route = createFileRoute('/plugins/')({ component: PluginCenter })
```
`PluginCenter` is a fixed-height container with a 3-tab header (using `components/ui/tabs.tsx`) and renders the active tab. Reuse `FIXED_HEIGHT_SECTIONS`-style layout (overflow-hidden outer, internal scroll).

**Surface + entry** (in `apps/web/src/navigation/`):
- Add `kind: 'plugin-center'` to `SurfaceKind` and a route variant `{ to: '/plugins' }` in `surface-identity.ts`.
- Add `openPluginCenter()` in `navigation-commands.ts` (mirrors `openAwaits`).
- **Settings sidebar** (`settings-sidebar.tsx`): the `plugins` nav item currently sets the overlay section. Change it to call `openPluginCenter()` instead — opening the center as its own surface. Remove `plugins` from `SettingsContent`'s `SECTION_MAP` (and the `PluginsSettings` import) so the overlay no longer owns it.

### B. Three tabs

All under `apps/web/src/features/plugins/` (new domain folder; the existing `features/settings/plugins-*.tsx` files migrate here).

#### Tab 1 — Marketplace (`marketplace-tab.tsx`)
- `useQuery(['plugins','marketplace'], () => getPluginsMarketplace())` — pulls `{ plugins, stale, fetchedAt }`.
- **Header row**: search input (client-side filter over displayName/description/tags), category filter chips (All / automation / mcp / integration / skill / dev), refresh button (calls `postPluginsMarketplaceRefresh`, invalidates query). Show a muted "更新于 X · 数据可能过期" when `stale`.
- **Featured row** (when category = All): horizontal scroll of `featured: true` entries as larger cards.
- **Grid**: `MarketplaceCard` per entry — icon, displayName, author, short description, category badge, tags.
  - `bundled: true` → badge "内置", primary button "启用" (calls `patchPluginsByRouteSegmentEnabled` after matching the installed plugin by name; if not currently installed/enabled, it's already on disk so Enable works directly). Trust consent applies for untrusted externals — but bundled are trusted, so no consent.
  - installable (`source` present) → primary button "安装". Determining installed state: match the entry's `source.location` + `source.subPath` against `GET /plugins/sources` (each source carries `location`/`subPath`). If matched → button becomes "已安装 ✓" (disabled) or "打开" (switches to Installed tab filtered to it). If a newer `version` exists in the catalog vs installed → "更新" (re-install via preview→install).
  - Click card → expands or opens a detail sheet (`components/ui/sheet.tsx`) with full description, homepage link, requested permissions (from preview), and Install/Enable CTA.
- **Install flow** (installable entries): clicking "安装" runs 030's preview→review→confirm pipeline. In the center it renders as an inline `InstallWizard` panel (or a `sheet.tsx` drawer) rather than a Dialog — the same 4 steps (paste is skipped; the entry's source is the input). Reuse 030's `postPluginsSourcesPreview` → review list with permissions/trust → `postPluginsSources` → done with per-plugin Enable + undo.

#### Tab 2 — Installed (`installed-tab.tsx`)
- Migrates `plugins-settings.tsx`'s plugin list into the center.
- `useQuery(['plugins','list'], getPlugins)` + `useQuery(['plugins','sources'], getPluginsSources)`.
- Header: search + filter (All / On / Off) + refresh — same as today.
- Grid of `InstalledCard` (the cleaned `PluginCard` from 029: icon, name, version, description, provenance line, enable `Switch`, `⋯` Uninstall for externals). No footer telemetry strip.
- **Trust-on-enable consent** (029 planned, 030 specified, never built): toggling ON an untrusted `externalLocal` plugin opens `TrustConsentDialog` (fetches `GET /plugins/:routeSegment`, lists `declaredPermissions`, proceeds with PATCH on confirm). Implement `plugins-trust-consent-dialog.tsx` per 030.
- **Uninstall**: `pluginIdentity → sourceId` lookup from sources; `DELETE /plugins/sources/:id` + `window.cradle?.plugins?.unsyncSource(identity)`. Confirm when source fans out to >1 plugin.

#### Tab 3 — Import (`import-tab.tsx`)
- 030's paste→preview→review→install flow, inlined as a page (not a Dialog).
- `Input` + live recognition chip (GitHub repo / npm package / cradle link) + clickable format examples.
- "查看将安装的内容" → `postPluginsSourcesPreview` → review list (checkboxes, permissions, trust) → "安装 N 个插件" → `postPluginsSources` → done (per-plugin Enable + undo).
- Plain-language error maps. No `ref`/`subPath`/`label` fields anywhere.
- This is the manual-paste escape hatch for plugins not in the marketplace.

### C. `settings/plugins` cleanup
- Remove `plugins` from `SECTION_MAP` and the `PluginsSettings` import in `settings-content.tsx`.
- `settings-sidebar.tsx` plugins item → `openPluginCenter()`.
- The old `apps/web/src/features/settings/plugins-settings.tsx` and `plugins-add-dialog.tsx` migrate to `apps/web/src/features/plugins/` (as `installed-tab.tsx` and the import wizard respectively); delete the dialog shell since Import is now a tab.

### D. Desktop bridge
Keep `window.cradle?.plugins?.syncSource(sourceId)` on install and `unsyncSource(identity)` on uninstall — guarded on `window.cradle` presence, unchanged from today.

---

## Locales

Edit `apps/web/src/locales/default/settings.ts` (type-checked source) + `zh-CN/settings.json` + `en-US/settings.json`.

**Remove** (Advanced form + overlay-section residue): `plugins.add.advancedToggle`, `plugins.add.ref`, `plugins.add.refPlaceholder`, `plugins.add.subPath`, `plugins.add.subPathPlaceholder`, `plugins.add.label`, `plugins.add.labelPlaceholder`.

**Rewrite**: `plugins.add.inputPlaceholder` → "粘贴 cradle:// 链接、GitHub 仓库地址或 npm 包名"; `plugins.add.description` → "粘贴一个插件来源，先预览它包含哪些插件，确认后再安装。"

**Add** — center shell:
- `plugins.center.title` = "插件中心"
- `plugins.center.tab.marketplace` = "市场"
- `plugins.center.tab.installed` = "已安装"
- `plugins.center.tab.import` = "导入"
- `plugins.center.search.placeholder` = "搜索插件…"
- `plugins.center.category.all` / `.automation` / `.mcp` / `.integration` / `.skill` / `.dev`
- `plugins.center.stale` = "数据可能已过期"
- `plugins.center.updatedAt` = "更新于 {{time}}"
- `plugins.center.empty` = "市场暂无插件"
- `plugins.center.refresh`

**Add** — marketplace card:
- `plugins.marketplace.bundled` = "内置"
- `plugins.marketplace.installed` = "已安装"
- `plugins.marketplace.install` = "安装"
- `plugins.marketplace.enable` = "启用"
- `plugins.marketplace.update` = "更新"
- `plugins.marketplace.open` = "打开"
- `plugins.marketplace.author` = "作者"
- `plugins.marketplace.permissions` = "{{count}} 项权限"
- `plugins.marketplace.featured` = "精选"

**Add** — import flow (from 030): `plugins.add.preview`, `plugins.add.resolving`, `plugins.add.installN`, `plugins.add.recognition.github`/`.npm`/`.cradle`, `plugins.add.example.*`, `plugins.preview.*` (empty/trusted/untrusted/permissions/select-all/selected-n), `plugins.add.undo`, `plugins.add.undoConfirm`, `plugins.add.error.repoNotFound`/`.network`/`.noPlugins`.

**Add** — trust consent (from 030): `plugins.trust.title`/`.body`/`.permissions`/`.confirm`/`.cancel`.

**Add** — installed: `plugins.uninstall`, `plugins.uninstallConfirmTitle`, `plugins.uninstallConfirmBody` (with `{{count}}`, `{{source}}`), `plugins.needsTrust`, provenance labels (`plugins.provenance.github`/`.npm`/`.local`/`.bundled`/`.workspaceDev`).

Keep existing `plugins.sources.toast.*` and `plugins.toast.*` keys.

---

## Files

| File | Change |
|---|---|
| `marketplace.json` (repo root) | **New** — curated catalog; seed with 6 bundled entries + known community plugins |
| `apps/server/src/modules/plugin-marketplace/catalog.ts` | **New** — fetch + singleton cache + TTL/stale (mirror `provider-catalog`) |
| `apps/server/src/modules/plugin-marketplace/service.ts` | **New** — `listMarketplace`, `refreshMarketplace` |
| `apps/server/src/modules/plugin-marketplace/model.ts` | **New** — `marketplaceEntry`, `marketplaceResponse` schemas |
| `apps/server/src/modules/plugin-marketplace/index.ts` | **New** — `GET /plugins/marketplace`, `POST /plugins/marketplace/refresh` |
| `apps/server/src/modules/plugins/service.ts` | Add `previewSource` + types (from 030) |
| `apps/server/src/modules/plugins/model.ts` | Add `previewPluginSourceBody` + `pluginSourcePreview` schemas (from 030) |
| `apps/server/src/modules/plugins/index.ts` | Register `POST /sources/preview` + mount marketplace routes |
| `apps/server/src/plugins/loader.ts` | `discoverAndActivateSource`: `refreshPluginSourceDirectory` → `resolvePluginSourceDirectory` (from 030) |
| `apps/web/src/api-gen/` | Regenerate client (`getPluginsMarketplace`, `postPluginsMarketplaceRefresh`, `postPluginsSourcesPreview` + types) |
| `apps/web/src/routes/plugins/index.tsx` | **New** — `/plugins` route, `PluginCenter` shell with tabs |
| `apps/web/src/navigation/surface-identity.ts` | Add `plugin-center` surface kind + `/plugins` route variant |
| `apps/web/src/navigation/navigation-commands.ts` | Add `openPluginCenter()` |
| `apps/web/src/features/settings/settings-sidebar.tsx` | `plugins` item → `openPluginCenter()` |
| `apps/web/src/features/settings/settings-content.tsx` | Remove `plugins` from `SECTION_MAP` + `PluginsSettings` import |
| `apps/web/src/features/plugins/marketplace-tab.tsx` | **New** — catalog grid + search + categories + featured + install wizard |
| `apps/web/src/features/plugins/installed-tab.tsx` | **New** — migrated cleaned plugin list + trust consent + uninstall |
| `apps/web/src/features/plugins/import-tab.tsx` | **New** — 030's paste→preview→install as an inline page |
| `apps/web/src/features/plugins/install-wizard.tsx` | **New** — shared preview→review→install→done component used by Marketplace + Import |
| `apps/web/src/features/plugins/plugins-trust-consent-dialog.tsx` | **New** — trust-on-enable consent (030) |
| `apps/web/src/features/plugins/plugin-source-parser.ts` | Moved from `features/settings/` (unchanged logic) |
| `apps/web/src/features/plugins/plugin-source-parser.test.ts` | Moved (unchanged) |
| `apps/web/src/locales/default/settings.ts` | Key add/remove/rewrite per above |
| `apps/web/src/locales/zh-CN/settings.json` | zh-CN copy |
| `apps/web/src/locales/en-US/settings.json` | en-US copy |
| `plans/README.md` | Status row for 031; mark 030 superseded by 031 (backend preview + trust consent merged into 031) |

## Steps

### Step 1 — Backend: marketplace module
Create `plugin-marketplace/{catalog,service,model,index}.ts`. Seed `marketplace.json` at repo root. Register routes on the `/plugins` prefix.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0. `curl …/plugins/marketplace` returns the catalog JSON with `stale:false`; a second call within TTL returns cached; `curl -X POST …/plugins/marketplace/refresh` forces a refetch.

### Step 2 — Backend: preview endpoint (from 030)
Implement `previewSource` + schemas + route; switch `loader.ts` to `resolvePluginSourceDirectory`.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0. `curl -X POST …/plugins/sources/preview -d '{"kind":"git","location":"<repo>"}'` returns preview JSON; `GET /plugins/sources` unchanged after a preview-only call (no DB write).

### Step 3 — Regenerate API client
Run the repo's OpenAPI gen command (confirm exact script from `package.json` / `cradle man` — do not invent).

**Verify**: `getPluginsMarketplace`, `postPluginsMarketplaceRefresh`, `postPluginsSourcesPreview` exist in `apps/web/src/api-gen/sdk.gen.ts` with matching types.

### Step 4 — Locales
Apply the key add/remove/rewrite list to all three locale files.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0.

### Step 5 — Route + surface + navigation
Add `/plugins` route file, `plugin-center` surface kind, `openPluginCenter()`, rewire settings-sidebar, clean `settings-content.tsx`.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0. Manual: clicking Plugins in settings sidebar opens `/plugins` as its own surface; old overlay section is gone.

### Step 6 — Marketplace tab
Catalog grid + search + categories + featured + refresh + stale indicator. `MarketplaceCard` with bundled/installed/installable states.

**Verify**: typecheck. Manual: browse, search, filter, refresh; bundled card shows "内置/启用"; installable card shows "安装".

### Step 7 — Install wizard (shared)
Build `install-wizard.tsx` (preview→review→install→done + undo), used by Marketplace Install and Import. Build `plugins-trust-consent-dialog.tsx`.

**Verify**: typecheck. Manual: install an entry from Marketplace → preview list with permissions/trust → select → install (single fetch — verify server logs show cache reuse) → done with per-row Enable (consent for untrusted) → undo removes source.

### Step 8 — Installed tab
Migrate cleaned plugin list; wire trust consent + uninstall.

**Verify**: typecheck + `pnpm --filter @cradle/web test`. Manual: toggle untrusted external → consent dialog; uninstall multi-plugin source → confirm → removed.

### Step 9 — Import tab
Inline 030's paste→preview→install page using the shared wizard.

**Verify**: typecheck. Manual: paste GitHub URL → recognition chip → preview → review → install → done.

### Step 10 — Full suite + smoke
- `pnpm --filter @cradle/web test` → exit 0.
- `pnpm --filter @cradle/server test` → exit 0.
- End-to-end: Marketplace install, Installed manage, Import paste — all three paths reach the shared wizard and succeed; cache reuse confirmed (no double fetch).

## Done criteria
- [ ] `/plugins` route exists as its own surface; settings sidebar Plugins opens it; settings overlay no longer has a plugins section.
- [ ] Marketplace tab lists catalog entries (seeded non-empty), with client-side search + category filter + featured row + refresh + stale indicator.
- [ ] Bundled entries show "内置" + Enable; installable entries show "安装"; already-installed show "已安装".
- [ ] Install (from Marketplace or Import) goes preview → review (permissions + trust + checkboxes) → install, single-fetch (cache reused).
- [ ] Installed tab: cleaned cards, trust-on-enable consent for untrusted externals, uninstall with multi-plugin confirm.
- [ ] Import tab: paste with live recognition, no `ref`/`subPath`/`label` fields.
- [ ] `POST /plugins/sources/preview` and `GET /plugins/marketplace` write nothing to the DB; preview activates nothing.
- [ ] Plain-language errors; no raw JSON shown to users.
- [ ] `pnpm --filter @cradle/web typecheck`/`test` and `pnpm --filter @cradle/server typecheck`/`test` exit 0.
- [ ] `plans/README.md` updated; 030 marked superseded by 031.

## STOP conditions
- The OpenAPI gen command isn't discoverable from `package.json` or `cradle man` — STOP and ask; don't invent a script.
- `provider-catalog`'s fetch/cache shape has drifted from what this plan mirrors (read at implementation time) — STOP and reconcile rather than copying a stale pattern.
- Adding a surface kind to `surface-identity.ts` requires touching more than `SurfaceKind` + `SurfaceRoute` + one command (e.g. a registry or a router guard) — STOP and map the real surface-registration surface before proceeding.
- `marketplace.json` hosting via GitHub raw is blocked by CORS when fetched server-side (it shouldn't be — server-side fetch has no CORS) — if for some reason the server can't reach it, STOP and confirm the network path / mirror URL with the user.

## Maintenance notes
- **Catalog curation**: `marketplace.json` is PR-maintained. Adding a plugin = one JSON edit + optional icon URL. No DB, no deploy. A future plan could add a submission flow (PR template) or auto-discovery from npm/GitHub, but curation keeps quality high and is the right starting point.
- **Bundled vs installable**: bundled entries (`bundled:true`) skip install (they're on disk) and the card offers Enable directly. If a bundled plugin is also distributed externally at a newer version, list it twice — once `bundled:true` (Enable) and once installable (Update) — or add a `bundledVersion` field for update detection later.
- **Search is client-side**: fine for tens of entries. If the catalog grows past ~200, move search server-side (add `GET /plugins/marketplace/search?q=`).
- **Cache TTL**: 60 min default. The refresh button + `stale` flag cover manual freshness. Operators can pin via `CRADLE_PLUGIN_MARKETPLACE_URL` (mirror) for air-gapped setups.
- **Icons**: catalog `icon` is a remote URL the frontend loads directly. Bundled plugins can reuse their in-repo `assets/icon.*` via the GitHub raw URL. No new icon endpoint needed.
- **`localPath`** remains CLI-only (unchanged from 029/030).
- **Deep-link `cradle://plugins/install`** primary path is untouched; the center's Import tab is the manual equivalent.

## Reconciliation — 2026-07-15

Plan 047 confirmed the transport/cache foundation assumed by this plan: server plugin preview and install share the source cache, and GitHub archives are durable Download Center tasks with redacted public progress. Marketplace catalog freshness remains a separate concern; no stale-cache map or marketplace semantics were introduced by the Download Center migration. This records existing foundation only and does not mark the Marketplace UI, catalog, or remaining Plan 031 criteria complete.
