# Cradle Design System · Cheatsheet

> Precise. Surface-textured. Physics-native.
> Read this file before every UI task — 2 minutes here saves an hour of cleanup.

For the *why* behind the invariants, read [`PHILOSOPHY.md`](./PHILOSOPHY.md).
For pattern recipes (Item, InputGroup, Message, Empty, Sheet), read [`references/compositions.md`](./references/compositions.md).

---

## The invariants

1. **Inset floating card** — content lives in a rounded card that floats on a chrome-colored sea. The gutter is the design.
2. **Two-tone chrome** — sidebar / header / footer are always dimmer than content. Never the same tone.
3. **Surface texture, not elevation** — depth is a 1px oklch ring plus a low-opacity soft cast. NO floating drop shadows on interactive elements.
4. **Geist everywhere** — `var(--font-sans)` and `var(--font-mono)`. Never hardcode a font-family.
5. **Pre-resolved text tiers** — 4 tiers (primary / secondary / tertiary / dim). Never stack opacity on a text token.
6. **Spring physics for motion** — stiffness 600 / damping 40 is the default. No `linear` or `ease-in-out` for interactive state.
7. **Spatial separation first** — prefer `gap` over a visible divider. Reach for a border when space alone can't carry it.
8. **Accent is semantic** — each accent maps to a content category. Never used decoratively, never two on one element.
9. **Static Tailwind classes only** — never construct class names dynamically. If a color depends on data, resolve to a small allowlist and use full class strings.
10. **No gradients, no uppercase tracking, no scrollbars** — flat surfaces, sentence-case headers, invisible scroll tracks.

---

## Color · Neutral

| Var | Hex | Tier | Use |
|---|---|---|---|
| `--color-neutral-1` | `#ffffff` | Surface | Page bg, content card |
| `--color-neutral-2` | `#f5f5f5` | Chrome | Sidebar, header, footer bg |
| `--color-neutral-3` | `#ebebeb` | Fill | Hover bg, subtle fill |
| `--color-neutral-4` | `#d4d4d4` | Fill+ | Strong fill, dividers |
| `--color-neutral-5` | `#a3a3a3` | Border | Ring, border indicator — NEVER as text |
| `--color-neutral-6` | `#737373` | Text | Secondary text, muted foreground |
| `--color-neutral-7` | `#595959` | Text | Chrome foreground, tertiary |
| `--color-neutral-8` | `#404040` | Text | Strong secondary |
| `--color-neutral-9` | `#262626` | Text | Primary body text, CTA bg |
| `--color-neutral-10` | `#141414` | Dark | Dark mode bg, max emphasis |

## Color · Accents (semantic)

| Var | Hex | Category |
|---|---|---|
| `--color-accent` | `#3b82f6` | Workspace (default) |
| `--color-accent-session` | `#8b5cf6` | Session / Builtin |
| `--color-accent-global` | `#0ea5e9` | Global |
| `--color-accent-scope` | `#10b981` | Workspace scope / Doc |
| `--color-accent-agent` | `#f43f5e` | Agent |
| `--color-accent-legacy` | `#f59e0b` | Legacy |
| `--color-accent-diff` | `#f97316` | Diff |
| `--color-accent-summary` | `#ec4899` | Summary |

Usage pattern: 10 % bg opacity + full-color text. Never solid accent as a fill on non-interactive elements.

## Color · Semantic status

| Var | Hex | Use |
|---|---|---|
| `--color-success` | `#10b981` | Success state |
| `--color-warning` | `#f59e0b` | Warning state |
| `--color-error` | `#ef4444` | Error / destructive |
| `--color-info` | `#3b82f6` | Info |

---

## Text tiers (never add opacity on top)

| Alias | Resolves to | Contrast on n-1 | Use |
|---|---|---|---|
| `--text-primary` | `--color-neutral-9` | ~14 : 1 | Body copy, labels, headings |
| `--text-secondary` | `--color-neutral-6` | 4.5 : 1 (AA) | Meta, timestamps, secondary info |
| `--text-tertiary` | `--color-neutral-7` | 6.2 : 1 (AA) | Chrome labels, placeholder |
| `--text-dim` | `--color-neutral-5` | 2.7 : 1 | Decorative / disabled only — not readable text |

Wrong: `text-[var(--color-neutral-9)]/70`. Right: pick the tier.

---

## Chrome / sidebar family

The two-tone architecture uses a distinct set of chrome tokens. Chrome is never the same tone as content.

| Var | Resolves to | Use |
|---|---|---|
| `--color-surface` | `--color-neutral-1` | Content bg — the "floating card" fill |
| `--color-surface-inset` | `--color-neutral-2` | Recessed content well (chat scroll region) |
| `--color-fill` | `--color-neutral-3` | Hover, muted fill, subtle surface |
| `--color-sidebar` | `--color-neutral-2` | Sidebar / header / footer bg (chrome) |
| `--color-sidebar-foreground` | `--color-neutral-7` | Chrome foreground text |
| `--color-sidebar-fill` | `rgba(0,0,0,0.04)` | Chrome row hover fill |
| `--color-sidebar-border` | `rgba(0,0,0,0.06)` | Chrome-region borders (dimmer) |
| `--color-border-content` | `rgba(0,0,0,0.08)` | Content-region borders |

Rule: chrome borders are lighter than content borders. The eye should read a hierarchy: chrome dims itself out, content asserts.

---

## Typography

| Role | Font | Size | Weight | Line-h |
|---|---|---|---|---|
| Display | `--font-sans` | 30px | 600 | 1.2 |
| Heading | `--font-sans` | 22px | 600 | 1.3 |
| Section title | `--font-sans` | 16px | 600 | 1.4 |
| Body lg | `--font-sans` | 14px | 400 | 1.6 |
| Body md | `--font-sans` | 13px | 400 | 1.5 |
| Body sm | `--font-sans` | 12px | 400 | 1.5 |
| Label md | `--font-sans` | 13px | 500 | 1.4 |
| Label sm | `--font-sans` | 12px | 500 | 1.4 |
| Caption | `--font-sans` | 11px | 400 | 1.3 |
| Code sm | `--font-mono` | 11px | 400 | 1.5 |
| Code xs | `--font-mono` | 10px | 400 | 1.0 |

Baseline: `text-wrap: balance` on all headings, `text-wrap: pretty` on paragraphs. Set on `:root`; opt out per element if you must.

---

## Spacing

| Token | Value | Use |
|---|---|---|
| xs | 4 px | Icon gap, tight padding |
| sm | 8 px | List row padding, inner gap |
| md | 16 px | Section padding, standard gap |
| lg | 24 px | Card padding, section gap |
| xl | 32 px | Page padding |
| 2xl | 64 px | Section separation |

## Border radius (scale multiplier)

The system has one root radius (`--radius: 0.625rem` = 10 px). Every step is derived. Change the root, the whole system scales.

| Step | Multiplier | Value | Use |
|---|---|---|---|
| `--radius-sm` | × 0.6 | 6 px | Chips, inline tags |
| `--radius-md` | × 0.8 | 8 px | Buttons, inputs |
| `--radius-lg` | × 1.0 | 10 px | Cards, panels |
| `--radius-xl` | × 1.2 | 12 px | Popovers, modals |
| `--radius-2xl` | × 1.6 | 16 px | Content cards, floating panels |
| `--radius-3xl` | × 2.4 | 24 px | Hero surfaces |
| `--radius-full` | — | 9999 px | Pills, avatars, badges |

## Shadow stack (layered elevation, borders as last resort)

| Token | Value | Use |
|---|---|---|
| `--shadow-xs` | 2 px cast + 1 px oklch ring @ 5 % | Inputs, small controls, popovers, menus — **borderless** |
| `--shadow-sm` | 3 px cast + 1 px oklch ring @ 6 % | Cards, floating chrome card, dialogs |
| `--shadow-md` | 16 px soft cast + 4 px near cast | Reserved — rare hero overlays only |
| `--shadow-lg` | 40 px far cast + 8 px near cast | Sheets, overlays, toasts — **borderless** |
| `--shadow-inset` | `inset 0 1px 0 rgba(255,255,255,0.05)` | Top highlight (bevel effect) |
| `--shadow-inset-ring` | `inset 0 0 0 1px rgba(0,0,0,0.06)` | Etched interior ring |

Shadow depth does not change between themes. Dark mode only appends a faint top inset highlight (`inset 0 1px 0 white/5–7 %`) so borderless surfaces still read as lifted.

Wrong: `border` on a popover or menu. Right: fill + `--shadow-md`; borders only when layout gap and shadow cannot separate two surfaces.

---

## Border contract (weakened)

| Token | Value | Use |
|---|---|---|
| `--color-border-content` | black / 6 % (light) · white / 5 % (dark) | Content-region borders — last resort |
| `--color-border-chrome` | black / 5 % (light) · white / 4 % (dark) | Chrome-region borders |

In `apps/web` these surface as `--border` (6 % / 5 %) and `--input` (7 % / 7 %).

---

## Motion · Spring physics

| Name | Kind | Stiffness | Damping | Extra | Use |
|---|---|---|---|---|---|
| Spring default | spring | 600 | 40 | — | Tab switches, panel toggles, accordion |
| Spring message | spring | 500 | 35 | — | Message list entrance (opacity + y) |
| Panel drill-in | spring | 600 | 40 | mass 0.8 | Sidebar pane cross-fade (opacity + x + blur) |

CSS fallbacks (icons, non-interactive):

| Token | Value | Use |
|---|---|---|
| `--duration-quick` | 120 ms | Icon swap, hover fill |
| `--duration-standard` | 200 ms | Non-interactive fades |
| `--duration-slow` | 300 ms | Ambient background pans |
| `--ease-standard` | `cubic-bezier(0.22, 1, 0.36, 1)` | Any non-spring easing |

---

## Layout constants

Fixed rails — do not theme these away.

| Token | Value |
|---|---|
| `--layout-sidebar-width` | 260 px |
| `--layout-sidebar-collapsed` | 48 px |
| `--layout-header-height` | 44 px |
| `--layout-footer-height` | 36 px |
| `--layout-content-max-chat` | 672 px |
| `--layout-content-max-wide` | 896 px |
| `--layout-gutter` | 4 px |

The gutter is the space between the sidebar sea and the floating content card. It's what makes the shell read as a physical object, not a flat page.

---

## Quick decisions

| Need | Use |
|---|---|
| Content background | `bg-[var(--color-surface)]` — the floating card fill |
| Chrome background | `bg-[var(--color-sidebar)]` — sidebar / header / footer |
| Primary text | `text-[var(--text-primary)]` — full opacity, no modifiers |
| Secondary text | `text-[var(--text-secondary)]` |
| Tertiary text | `text-[var(--text-tertiary)]` |
| Decorative / disabled | `text-[var(--text-dim)]` |
| Interactive hover fill | `bg-[var(--color-fill)]` |
| Content border | `border-[var(--color-border-content)]` |
| Chrome border | `border-[var(--color-border-chrome)]` |
| Category chip | `bg-{accent}/10 text-{accent}` |
| Surface presence | `shadow-[var(--shadow-sm)]` |
| Interior well | `shadow-[var(--shadow-inset-ring)]` |
| Pressed / focused | inset-shadow — never a lift |
| CTA button | `bg-[var(--color-neutral-9)] text-[var(--color-neutral-1)]` |
| Code / mono | `font-mono` — never hardcode Geist Mono |
| Interactive motion | Framer Motion spring `{ stiffness: 600, damping: 40 }` |

---

## Selection rules · overlays

| Need | Use |
|---|---|
| Persistent side panel (coexists with content) | Sheet |
| Blocking confirmation / delete | Dialog |
| Lightweight contextual controls | Popover |
| Button-triggered action menu | DropdownMenu |
| Right-click on content | ContextMenu |
| Global command palette | Command (Cmd+K) |

Prefer Sheet for anything that might need to stay open while the user works. Dialog only for truly blocking interactions.

---

## Verification

```bash
pnpm check    # token drift + template lint
pnpm test     # unit tests
```

What it validates:
- Every hex in this file matches `src/tokens.css`
- No `text-neutral-50…950` (or bg / border / ring variants) in templates
- No raw hex in inline style attributes
- No hardcoded `font-family` values
