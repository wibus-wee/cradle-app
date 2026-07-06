# Plan 029 — Redesign Plugins Settings for C-end (overturn the dev-style import form)

> **Executor instructions**: Frontend-only. Reuse the existing `POST/DELETE /plugins/sources` + `PATCH /plugins/:routeSegment/enabled` API as-is — no backend changes. Verify each step. Update `plans/README.md`.

## Status
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — pure UI rewrite of one settings page + a pure parser module with tests; no API, schema, or desktop-layer changes.
- **Depends on**: 027 (the `/plugins/sources` API this redesign consumes is already shipped)
- **Category**: UX / consumer-facing
- **Planned at**: 2026-07-06

## Why this matters

The current `apps/web/src/features/settings/plugins-settings.tsx` ships a **developer console masquerading as a settings page**:

- An inline "Sources" form with a `localPath | git | npm` **kind dropdown** and four raw fields: `location`, `ref`, `subPath`, `label` — straight monorepo vocabulary. A consumer has no idea what an "npm ref" or "subPath" is.
- `PluginSourceCard` prints `source.location` and `resolvedDirectory` (a full filesystem path) in **monospace**, plus raw error text in destructive red — internal telemetry, not a product surface.
- `PluginCard`'s footer strips expose `routeSegment` (monospace), `Server`/`Web`/`Desktop` layer chips, a capability-count chip, a `pinned` badge, and a corner `source.kind` label — all implementation detail.

C-end users think in **plugins**, not **sources**. They want to: paste a link/URL/package → see what it is → install → toggle on/off → uninstall. This plan overturns the import design around that mental model, reusing the existing backend (which already returns rich discovered-plugin metadata and gates activation behind the Plan 008 checksum trust grant).

## Scope

**In scope (frontend only):**
- Rewrite `apps/web/src/features/settings/plugins-settings.tsx`:
  - **Delete** the inline "Sources" form section and the `PluginSourceCard` list from the main view. Sources are no longer a first-class UI concept; they're an implementation detail.
  - **Replace** the form with a single primary `+ Add plugin` button (header) → opens an `AddPluginDialog`.
  - **Clean up `PluginCard`**: remove the footer telemetry strip (`routeSegment`, layer chips, capability-count chip), the `pinned` badge, and the corner `source.kind` label. Keep icon + displayName + version + description + enable `Switch`. Add a subtle provenance line ("GitHub · owner/repo" / "npm · @scope/pkg" / "本地 · /path" / "内置" / "开发"). Add a `⋯` dropdown menu with **Uninstall** (only for `source.kind === 'externalLocal'`).
  - **Empty state** gets a primary `Add plugin` CTA.
- New `AddPluginDialog` (in the same file or a sibling `plugins-add-dialog.tsx`):
  - **One smart text input**: "粘贴插件链接、GitHub 仓库地址或 npm 包名". Auto-detects kind — no dropdown:
    | Input | Detected | Maps to |
    |---|---|---|
    | `cradle://plugins/install?...` | deep-link | `git`, `location`=repository, `ref`=ref, `subPath`=path |
    | `https://github.com/owner/repo[/tree/<ref>/<subpath>]` | git URL | `git`, `location`=owner/repo, `ref`+`subPath` from `/tree/…` |
    | `owner/repo` | git shorthand | `git`, `location`=owner/repo, `ref`=main |
    | `@scope/pkg` or `pkg` | npm | `npm`, `location`=pkg |
  - **Collapsed "Advanced" disclosure** (closed by default) for power users who genuinely need explicit `ref` / `subPath` / `label`. Hidden so it never pollutes the C-end flow.
  - **Installing** state: spinner while `POST /plugins/sources` runs.
  - **Result step**: on success, show discovered plugin(s) — icon, name, version, description — with a clear "已添加，启用后开始使用" message and per-plugin `Enable` / global `Done`. On error, plain-language message + `Try again` (backend already auto-cleans the failed source row in `createSource`).
- New pure module `apps/web/src/features/settings/plugin-source-parser.ts`:
  - `parsePluginSourceInput(raw: string): ParsedPluginSource | null` where `ParsedPluginSource = { kind: 'git' | 'npm', location: string, ref?: string, subPath?: string }`.
  - All detection logic lives here, fully unit-testable, no React.
- New `apps/web/src/features/settings/plugin-source-parser.test.ts`: covers every input shape above + rejection of garbage / path traversal.
- **Trust-on-enable consent**: when the user toggles ON a plugin whose `source.kind === 'externalLocal' && !source.trusted`, intercept the toggle → open a small consent dialog that fetches `GET /plugins/:routeSegment` (full descriptor with `declaredPermissions`), lists the requested permissions in plain language, and only proceeds with `PATCH …/enabled` on confirm. Toggling OFF or toggling trusted/built-in plugins stays a direct PATCH (no dialog).
- **Uninstall flow**: build a `pluginIdentity → sourceId` lookup from `GET /plugins/sources` (each source carries its `plugins[]`). Uninstall = `DELETE /plugins/sources/:sourceId` + `window.cradle?.plugins?.unsyncSource(pluginIdentity)` for desktop. If the source fans out to >1 plugin, confirm: "这将移除来自 {label} 的 N 个插件。" Built-in / `workspaceDev` plugins hide Uninstall.
- **Locales** (`apps/web/src/locales/default/settings.ts` type-checked source + `zh-CN/settings.json` + `en-US/settings.json`):
  - Remove the now-unused `plugins.sources.form.*` and `plugins.sources.kind.*` and `plugins.sources.title/description` keys (the dev form is gone).
  - Keep `plugins.sources.toast.added/addFailed/removed/removeFailed` (reused by the dialog/uninstall flows) but rename namespace to `plugins.toast.*` for clarity if cheap; otherwise leave the keys.
  - Add: `plugins.add.title`, `plugins.add.description`, `plugins.add.inputPlaceholder`, `plugins.add.inputLabel`, `plugins.add.advancedToggle`, `plugins.add.ref`, `plugins.add.subPath`, `plugins.add.label`, `plugins.add.submit`, `plugins.add.installing`, `plugins.add.resultTitle`, `plugins.add.resultHint`, `plugins.add.enableAll`, `plugins.add.done`, `plugins.add.errorHint`, `plugins.uninstall`, `plugins.uninstallConfirmTitle`, `plugins.uninstallConfirmBody` (with `{{count}}`, `{{source}}`), `plugins.trust.title`, `plugins.trust.body`, `plugins.trust.permissions`, `plugins.trust.confirm`, `plugins.trust.cancel`, `plugins.provenance.github`, `plugins.provenance.npm`, `plugins.provenance.local`, `plugins.provenance.bundled`, `plugins.provenance.workspaceDev`, `plugins.needsTrust`.

**Out of scope:**
- Backend API changes (none — `POST/DELETE /plugins/sources`, `GET /plugins/:routeSegment`, `PATCH …/enabled` reused as-is).
- `localPath` UI affordance. `localPath` sources remain addable via CLI (`cradle plugin source add`); the C-end dialog intentionally does not expose a folder picker, which avoids dragging desktop/preload/IPC into scope. (If a user pastes an absolute path, the parser returns `null` and the dialog shows a hint pointing to CLI.)
- A marketplace/browse catalog — the "Add plugin" dialog is a manual paste path; deep-link (`cradle://plugins/install`) remains the primary install path, handled separately by the desktop layer.
- Sandboxing / execution isolation — unchanged from Plans 026–028.

## Files

| File | Change |
|---|---|
| `apps/web/src/features/settings/plugins-settings.tsx` | Rewrite: kill dev form + sources list; clean `PluginCard`; add `+ Add plugin` header button; trust-on-enable; uninstall; provenance |
| `apps/web/src/features/settings/plugin-source-parser.ts` | **New** — `parsePluginSourceInput` pure function |
| `apps/web/src/features/settings/plugin-source-parser.test.ts` | **New** — parser unit tests |
| `apps/web/src/locales/default/settings.ts` | Remove `plugins.sources.form.*` / `plugins.sources.kind.*` / `plugins.sources.title` / `plugins.sources.description`; add new `plugins.add.*`, `plugins.uninstall*`, `plugins.trust.*`, `plugins.provenance.*`, `plugins.needsTrust` keys |
| `apps/web/src/locales/zh-CN/settings.json` | Same key changes, zh-CN copy |
| `apps/web/src/locales/en-US/settings.json` | Same key changes, en-US copy |
| `plans/README.md` | Status row for 029 |

## Steps

### Step 1: Parser + tests (no UI yet)
Create `plugin-source-parser.ts` and `plugin-source-parser.test.ts`. Cover: `cradle://plugins/install?source=github&repository=owner/repo&path=packages/p&version=1.2.3&channel=bundled&ref=main` → `{kind:'git', location:'owner/repo', ref:'main', subPath:'packages/p'}`; `https://github.com/owner/repo/tree/v1.2.3/packages/p` → `{kind:'git', location:'owner/repo', ref:'v1.2.3', subPath:'packages/p'}`; `https://github.com/owner/repo` → `{kind:'git', location:'owner/repo'}`; `owner/repo` → `{kind:'git', location:'owner/repo'}`; `@scope/pkg` → `{kind:'npm', location:'@scope/pkg'}`; `pkg` → `{kind:'npm', location:'pkg'}`; absolute paths / traversal / garbage → `null`.

**Verify**: `pnpm --filter @cradle/web test -- plugin-source-parser` → pass.

### Step 2: Locales
Edit all three locale files per the key list above. Keep copy tight and consumer-facing (e.g. zh-CN `plugins.add.inputPlaceholder`: "粘贴插件链接、GitHub 仓库地址或 npm 包名").

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0 (the `default/settings.ts` source is type-checked, so missing/extra keys surface here).

### Step 3: Rewrite `plugins-settings.tsx`
Implement the cleaned page + `AddPluginDialog` + trust-on-enable consent + uninstall flow, reusing the existing React Query mutations and `window.cradle?.plugins?.syncSource/unsyncSource` desktop bridge (guard on `window.cradle` presence).

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0.

### Step 4: Manual smoke + full suite
- `pnpm --filter @cradle/web test` → exit 0.
- Manual: add via GitHub URL → see discovered plugin (disabled) → enable (consent dialog for external) → toggle off → uninstall.

## Done criteria
- [ ] No `kind` dropdown, no `ref`/`subPath`/`label`/`location`/`resolvedDirectory`/`routeSegment` visible on the default plugins settings page.
- [ ] One smart input in the Add dialog auto-detects `cradle://` / GitHub URL / `owner/repo` / npm package.
- [ ] `PluginCard` shows only icon, name, version, description, provenance line, enable switch, and (for external) an Uninstall action — no footer telemetry strip.
- [ ] Enabling an untrusted `externalLocal` plugin shows a permission-consent dialog before activation.
- [ ] Uninstall removes the source and deactivates its plugin(s); confirms when the source has multiple plugins.
- [ ] `pnpm --filter @cradle/web typecheck` and `pnpm --filter @cradle/web test` exit 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions
- The list endpoint's `PluginListEntry` turns out not to carry `source.trusted` (it does today, but if the generated type changed) — STOP and fetch the full descriptor for the trust check instead of guessing.
- `pnpm --filter @cradle/web test -- plugin-source-parser` can't be scoped that way (script name differs) — STOP and use the repo's real test-invocation shape (`cradle man` / `package.json` scripts) rather than inventing one.

## Maintenance notes
- `localPath` sources are now CLI-only (`cradle plugin source add`). If C-end demand for a folder picker appears later, that's a desktop/preload IPC addition (folder-picker dialog) + a small button in `AddPluginDialog` — separate plan.
- The deep-link (`cradle://plugins/install`) primary install path is unchanged; this plan only redesigns the in-Settings manual add + management surface.
