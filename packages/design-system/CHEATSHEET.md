# Cradle Design System · Cheatsheet

> Minimal. Surface-textured. Spring physics everywhere.
> Before every mockup or component task, read this file first.

---

## Invariants

1. **Surface texture, not elevation** — `inset-shadow` for depth; NO floating box-shadows
2. **Two-tone chrome** — sidebar/header (#f5f5f5 light / #111111 dark) is always dimmer than content (#ffffff / #141414)
3. **Geist Variable everywhere** — use `var(--font-sans)` or `var(--font-mono)`; never hardcode font-family
4. **Pre-resolved text tiers** — never add opacity on top of text tokens; 4 tiers (primary, secondary, tertiary, dim)
5. **Spring physics for motion** — stiffness 600, damping 40; no linear transitions for interactive state
6. **Spatial separation first** — prefer layout gap over visible borders
7. **Accent is semantic** — each accent color maps to a content category, never used decoratively
8. **No uppercase labels** — section headers: sentence case or lowercase only
9. **Static Tailwind classes only** — never construct class names dynamically (e.g. `` `bg-${color}-500` ``)
10. **No gradient backgrounds** — flat surfaces + subtle inset-shadow texture

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

## Color · Accents

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

## Color · Semantic

| Var | Hex | Use |
|---|---|---|
| `--color-success` | `#10b981` | Success state |
| `--color-warning` | `#f59e0b` | Warning state |
| `--color-error` | `#ef4444` | Error / destructive |
| `--color-info` | `#3b82f6` | Info |

---

## Typography

| Role | Font | Size | Weight | Line-h |
|---|---|---|---|---|
| Display | `--font-sans` | 30px | 600 | 1.2 |
| Heading | `--font-sans` | 18px | 600 | 1.3 |
| Section title | `--font-sans` | 16px | 600 | 1.4 |
| Body lg | `--font-sans` | 14px | 400 | 1.6 |
| Body md | `--font-sans` | 13px | 400 | 1.5 |
| Body sm | `--font-sans` | 12px | 400 | 1.5 |
| Label md | `--font-sans` | 13px | 500 | 1.4 |
| Label sm | `--font-sans` | 12px | 500 | 1.4 |
| Caption | `--font-sans` | 11px | 400 | 1.3 |
| Code sm | `--font-mono` | 11px | 400 | 1.5 |
| Code xs | `--font-mono` | 10px | 400 | 1.0 |

---

## Spacing

| Token | Value | Use |
|---|---|---|
| xs | 4px | Icon gap, tight padding |
| sm | 8px | List row padding, inner gap |
| md | 16px | Section padding, standard gap |
| lg | 24px | Card padding, section gap |
| xl | 32px | Page padding |
| 2xl | 64px | Section separation |

## Layout

| Token | Value |
|---|---|
| Sidebar width | 260px |
| Sidebar collapsed | 48px |
| Header height | 40px |
| Footer height | 36px |
| Content max (chat) | 672px |
| Content max (wide) | 896px |

## Border Radius

| Token | Value | Use |
|---|---|---|
| sm | 6px | Small chips, inline tags |
| md | 8px | Buttons, inputs |
| base | 10px | Cards, panels |
| lg | 12px | Popovers, modals |
| xl | 16px | Content cards, floating panels |
| full | 9999px | Pills, badges |

---

## Animation

| Name | Type | Stiffness | Damping | Use |
|---|---|---|---|---|
| Spring default | spring | 600 | 40 | Tab switches, panel toggles |
| Spring message | spring | 500 | 35 | Message entrance |
| Panel drill-in | spring | 600 | 40 | Navigation forward |

---

## Quick Decisions

| Need | Use |
|---|---|
| Background color | `--color-neutral-1` (content) or `--color-neutral-2` (chrome) |
| Primary text | `--color-neutral-9` — full opacity, no modifiers |
| Secondary text | `--color-neutral-6` |
| Tertiary text | `--color-neutral-7` |
| Decorative/disabled | `--color-neutral-5` |
| Interactive hover bg | `--color-neutral-3` |
| Border | `rgba(0,0,0,0.08)` — never `--color-neutral-5` |
| Category color | Matching `--color-accent-*` at 10% bg opacity, 60% text |
| Depth / surface feel | `inset-shadow` — NOT `box-shadow` |
| CTA button | `bg-neutral-9 text-neutral-1` (inverted) |
| Code / mono | `var(--font-mono)` — never hardcode Geist Mono |
| Animation | Spring physics (600/40) — no `linear` or `ease-in-out` for interactive |

---

## Verification

```bash
pnpm check    # token drift + template lint
pnpm test     # unit tests
```

What it validates:
- Every hex in this file matches `src/tokens.css`
- No `text-neutral-50…950` classes in templates
- No raw hex in inline style attributes
- No hardcoded font-family values
