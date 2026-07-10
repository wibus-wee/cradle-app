# 037 — Theme Customization Settings: UI/UX Redesign

## Problem

The theme-customization settings UI (`apps/web/src/features/settings/theme-customization-settings.tsx`) is hard to use:

- **Light/Dark tab toggle** at the top forces back-and-forth switching; you can't see or customize both variants at once.
- **Single-variant live preview**, even though `SystemThemePreview` (light | dark side-by-side) already exists in `theme-preview.tsx`.
- Colors use the **native `<input type="color">`** (`ThemeColorInput`) — no hex field, no eyedropper, no presets — while a full HSV color palette (`BrowserColorPalette`) already exists in the browser feature and is what we want here.
- **No reset**: once an override is set there is no way back to the Cradle default except hand-editing. The store has no reset action.
- Only 3 colors exposed (accent / background / foreground).

## Decisions (confirmed with user)

- **Color tokens: keep the existing 3** (accent / background / foreground). No new tokens, no `applyThemeProfile` runtime changes.
- **Layout: two columns side-by-side** (Light | Dark), shared side-by-side preview on top, no tab.

## Changes

### 1. Store: add reset — `apps/web/src/store/theme-customization.ts`

- Add action `resetOverrides(profileId: string): void` → sets that profile's `overrides` back to `{ ...EMPTY_OVERRIDES }` (all `null` = Cradle defaults). Add to the `ThemeCustomizationState` interface.
- Per-field reset needs **no** new action: `updateOverrides(id, { accentColor: null })` already clears one field.

### 2. Relocate + generalize the palette — `features/browser/browser-color-palette.tsx` → `components/ui/color-palette.tsx`

- Move the file into the shared `components/ui/` layer (it already only depends on `ui/popover`, `ui/button`, `ui/input`, `cn`, `motion` — no browser-specific deps).
- Rename export `BrowserColorPalette` → `ColorPalette` (drop the browser prefix now that it is shared).
- Add optional `disableAlpha?: boolean` prop: when true, hide the opacity slider + `%` input and force `a = 1` on commit. Theme colors are always opaque, so without this the alpha slider would be a non-functional control.
- Update the single existing consumer `features/browser/browser-annotation-adjustment-panel.tsx` (`BrowserColorPalette` → `ColorPalette`). Behavior there is unchanged (alpha still enabled by default).

### 3. Rewrite the settings UI — `apps/web/src/features/settings/theme-customization-settings.tsx`

Target structure:

```
SettingsGroup "Theme profiles" (bare)
  shared preview: SystemThemePreview(light, dark)   ← always both, side-by-side, ~h-40
  toolbar: [Import]  (+ import error text)
  ┌─ Light column ──────────┐  ┌─ Dark column ───────────┐
  │ header "Light" + [Dup]  │  │ header "Dark"  + [Dup]   │
  │ profile cards grid      │  │ profile cards grid       │
  │   (mini ThemePreview)   │  │                          │
  │ Name      [input]    ↺  │  │ …                        │
  │ Accent    [palette]  ↺  │  │                          │
  │ Background [palette] ↺  │  │                          │
  │ Foreground [palette] ↺  │  │                          │
  │ UI font   [input]    ↺  │  │                          │
  │ Code font [input]    ↺  │  │                          │
  │ Translucent sidebar [Switch] ↺                       │
  │ Contrast  [Slider]      │  │                          │
  │ [Reset to defaults]     │  │ [Reset to defaults]      │
  └─────────────────────────┘  └──────────────────────────┘
```

- **Remove** the light/dark variant tab toggle entirely.
- **Two `ThemeProfileEditor` columns** (one per variant), each bound to its variant's active profile via `selectActiveThemeProfile(state, variant)`. Editing a column updates only that variant's active profile.
- **`ThemeColorField`** (replaces `ThemeColorInput`): label + `ColorPalette` swatch (with `disableAlpha`) + hex value text + per-field reset (rotate-ccw, enabled only when the override ≠ `null`). Reset sets the override to `null`.
- **Per-field reset** (rotate-ccw) on fonts, translucent-sidebar switch, and contrast too — enabled only when that field is overridden.
- **Per-profile "Reset to defaults"** button → `resetOverrides(profileId)`, enabled only when at least one override is set; small confirm popover before clearing (multi-field, mildly destructive).
- **Duplicate** button moves into each column header (duplicates that column's active profile).
- **Import** stays a shared toolbar action — the imported JSON declares its own `variant`, so it lands in the correct column automatically and appears in that column's profile grid.
- Keep existing testids where natural: `appearance-theme-import`, `appearance-theme-duplicate`, `appearance-theme-name`, `appearance-theme-ui-font`, `appearance-theme-code-font`, `appearance-theme-translucent-sidebar`, `appearance-theme-contrast`, `appearance-theme-profile-{id}`. Add `appearance-theme-reset` (per profile). Drop the now-irrelevant variant-tab testids.
- Responsive: two columns at `sm:` and up; stack to a single column on narrow widths.
- No test references the customization testids today (only `appearance-theme-${value}` in the mode picker, which is untouched), so testid reshaping is safe.

### 4. `theme-preview.tsx` — no structural change

`SystemThemePreview` is already the side-by-side preview we want; reuse it at the top. `ThemePreview` (single) stays in use by the profile cards and the `appearance-settings.tsx` mode picker.

### 5. i18n — add keys to all 5 locale files

`locales/default/settings.ts` + `locales/{en-US,es-ES,ja-JP,zh-CN}/settings.json`:

- `appearance.customization.resetProfile` — "Reset to defaults" / "恢复默认"
- `appearance.customization.resetProfileConfirm` — "Clear all overrides for this profile?" / "清除该配置的所有覆盖？"
- `appearance.customization.resetField` — "Reset {field}" (aria label)
- `appearance.customization.duplicateProfile` — "Duplicate profile" (aria)
- `appearance.customization.light` / `.dark` column headers (or reuse existing `appearance.theme.light/dark`)
- Tweak `appearance.customization.description` to mention reset-to-defaults availability.
- Repurpose `appearance.customization.livePreview*` as the caption for the shared top preview (or drop if redundant).

### 6. Tests — `apps/web/src/store/theme-customization.test.ts`

- Add a case for `resetOverrides`: after overriding a profile then calling reset, `resolveThemePreview` returns defaults and `applyThemeProfile` leaves no inline styles on `<html>`.
- No existing component test for this UI; not adding one (keep scope tight). Testids preserved for future e2e.

## Out of scope

- No new color tokens (confirmed).
- No `applyThemeProfile` / runtime changes — the 3 existing mappings stay.
- Not touching the `appearance-settings.tsx` Light/Dark/System mode picker above the customization card.

## Verification

- Typecheck + lint for `apps/web`.
- `apps/web` unit tests (store).
- Manual: Settings → Appearance → two columns render; shared side-by-side preview updates live as either column edits; `ColorPalette` opens with HSV field / hue slider / hex / eyedropper / presets; per-field reset restores the Cradle default for that field; "Reset to defaults" clears a whole profile (with confirm); import still drops into the right column; duplicate works per column.
