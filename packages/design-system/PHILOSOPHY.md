# Cradle Design Philosophy

> Every visual decision in Cradle exists to serve one goal: **make an AI-native desktop environment feel like a real place to think, not a web page you're passing through.**

This document is the *why*. `CHEATSHEET.md` is the *what*. `references/` is the *how*.

If a design decision doesn't reconcile with one of the pillars below, the decision is wrong — not the pillar.

---

## The core stance

Cradle sits at a specific coordinate on the design landscape:

```
                             editorial · marketing
                                     ▲
                                     │
     ornamental · playful  ◀────────┼────────▶  precise · technical
                                     │
                                     ▼
                            desktop tool · lived-in
                                     │
                              ★ Cradle lives here
```

We share a corner with Linear and Vercel: precise, high-contrast, unsentimental. We diverge from them by being **physics-native** (spring motion everywhere), **AI-semantic** (accent colors mean content categories, not decoration), and **surface-textured** (inset shadows, not floating elevation).

Cradle is a *desktop environment* — not a web app that happens to run on the desktop. That framing decides most tradeoffs: chrome density over marketing white space, muscle-memory rails over layout novelty, subtle physicality over Material-Design flourish.

---

## The seven pillars

### 1 · Two-tone chrome, floating content

The single strongest identity signature in Cradle is the **inset floating card in a sidebar sea**:

```
┌─────────────────────────────────────────────────────────────┐
│ sidebar bg  ┌─────────────────────────────────────────┐     │
│  (dimmer)   │  content surface                        │     │
│  ─────      │  (brighter, rounded, shadow-sm)         │     │
│  sidebar    │                                         │     │
│  rows       │  ┌─ header ─┐                          │     │
│             │  │           │                          │     │
│             │  └───────────┘                          │     │
│             │  ┌─ main content ─────────────┐        │     │
│             │  │                             │        │     │
│             │  └─────────────────────────────┘        │     │
│             └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
   ↑ everything outside the card is chrome (color-sidebar)
   ↑ the card is content surface (color-surface)
   ↑ a 4px gutter separates them — the shell breathes
```

**Why**: the AI content inside the card is unpredictable and inherently changing. The chrome around it must feel stable, quieter, and always in the same place. Two tones — chrome dimmer than content — encode that hierarchy at the perceptual level, before the eye reads a single word.

**Rules**:
- `--color-sidebar` is always used for chrome (sidebar, header, footer, right aside).
- `--color-surface` is always brighter than `--color-sidebar`, whether light or dark theme.
- The content card sits inside chrome with a `--layout-gutter` margin and `--radius-xl` corners.
- `--shadow-sm` (a 1-px oklch ring plus a soft cast) defines the card's edge — never `shadow-lg` or `shadow-xl`.

### 2 · Layered elevation, borders as last resort

Cradle separates surfaces through **fill steps and layered shadows** — not visible strokes. A border is the last tool you reach for, when fill and shadow cannot convey separation on their own.

Overlays (popovers, menus, selects, comboboxes) **do float**, but barely: they carry `--shadow-xs` with *no* `border` class. Dialogs use `--shadow-sm`; only sheets, drawers and toasts reach `--shadow-lg`. In dark mode the shadow stack adds a faint top inset highlight (`inset 0 1px 0 white/5-7%`) instead of a keyline, so the surface lifts off the page cleanly.

Page-embedded cards stay quiet: `--shadow-sm` at most, edge defined by the token, never a hand-rolled ring.

**Why**: every visible 1px stroke is noise at desktop density. Fill + shadow produce hierarchy the eye reads *spatially*; borders produce hierarchy the eye reads *bureaucratically*.

**Rules**:
- Use `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg` — never a hand-rolled `shadow-*` with arbitrary blur.
- Elevated surfaces (popover, menu, dialog, sheet, toast, tooltip content) ship **borderless**. Separation comes from the shadow token.
- For pressed / focused states, use `--shadow-inset-ring` (an inset 1-px ring), not a bigger outer shadow.

### 3 · Spring physics, not CSS transitions

Every interactive motion in Cradle uses **spring physics** (Framer Motion). Linear and ease-in-out transitions are banned for state changes the user *causes*.

**Why**: linear motion reads as CSS animation — the seams show. Spring motion approximates real physical objects; the user's brain reads it as *real*, not *animated*. This is what makes AI interactions feel *alive* instead of *scripted*.

**The three canonical springs** (see `--spring-*` tokens):
- **Default** (600 / 40) — tab switches, panel toggles, accordion.
- **Message** (500 / 35) — message list entrances (slightly warmer, longer settle).
- **Drill-in** (600 / 40, mass 0.8) — sidebar pane navigation (opacity + x + blur).

CSS `transition` is still used for non-interactive states (hover fills, icon swaps) via `--duration-quick` (120ms), `--duration-standard` (200ms), `--duration-standard`, always with `--ease-standard`.

### 4 · Accent is semantic, never decorative

Cradle's eight accent colors each map to a **content category**, not a mood or a section theme.

| Accent | Category |
|---|---|
| `--color-accent` (`#3b82f6`) | Workspace (default) |
| `--color-accent-session` | Session / Builtin |
| `--color-accent-global` | Global |
| `--color-accent-scope` | Workspace scope / Doc |
| `--color-accent-agent` | Agent |
| `--color-accent-legacy` | Legacy |
| `--color-accent-diff` | Diff |
| `--color-accent-summary` | Summary |

**Why**: an AI desktop mixes content from *many* origins (the workspace, an agent, a global lookup, a summary of another thread). The user must be able to see, in a peripheral glance, *where this piece of content came from*. Semantic accents let the eye triangulate origin before reading a word.

**Rules**:
- Never use accents as decorative color. A "pretty blue" is not `--color-accent`.
- Accents ship as `bg-<accent>/10` + `text-<accent>/60~70` pairs. That's it. Solid accent backgrounds are used only when the *entire element* means the category (badges, active-workspace indicators).
- No gradients. No conic sweeps. No two accents on one element (except the onboarding brand ring — which is *the* exception).

### 5 · Type is one voice, four contrast tiers

**Geist Variable** everywhere. **Geist Mono** for code and monospaced chrome (paths, versions, timestamps). Nothing else.

Text has **exactly four tiers** — each with a locked WCAG ratio:

| Tier | Var | Ratio (on `--color-neutral-1`) | Use |
|---|---|---|---|
| Primary | `--text-primary` | ~14 : 1 | Body copy, headings, labels |
| Secondary | `--text-secondary` | ~4.5 : 1 (AA) | Meta, timestamps |
| Tertiary | `--text-tertiary` | ~6.2 : 1 (AA) | Chrome labels, placeholder |
| Dim | `--text-dim` | ~2.7 : 1 | Decorative / disabled — **not readable text** |

**Why**: opacity stacking (`text-neutral-9/70`) creates a fifth ad-hoc tier with an unverified contrast ratio. In dark mode, it doubles the drift. Pre-resolved tiers make contrast a *decision*, not an accident.

**Also**:
- `h1..h6 { text-wrap: balance }` and `p { text-wrap: pretty }` at the root — copy reads well without hand-tuning.
- Geist stylistic alternates: `font-feature-settings: 'cv01', 'cv02', 'cv03', 'cv04', 'calt'`.
- No uppercase tracking labels. No `tracking-wider`. Sentence case, always.

### 6 · Space over lines

Prefer **layout gap** over visible borders. Separators are used only when spatial layout cannot convey separation.

**Why**: every border is a strong horizontal line — an interruption. Cradle's density is high; a border-heavy layout reads as bureaucratic. Space is quieter, and it scales without repainting.

**Rules**:
- If a `gap-2` between siblings already reads as "these are separate things," drop the border.
- Reserve `<Separator />` for cases where two adjacent regions *must* be visually severed (menu group breaks, form fieldset dividers).
- Border colors are `--color-border-content` (rgba 6%) for content regions and `--color-border-chrome` (rgba 5%) for chrome — never a named neutral step.

### 7 · One radius, one scale, one grid

**Radius is a scale multiplier**, not a bag of literals. Change `--radius` and every rounded corner in Cradle re-tunes together.

Spacing is a **six-step scale** (xs 4 · sm 8 · md 16 · lg 24 · xl 32 · 2xl 64). Anything else is a code smell.

Layout has **fixed rails** (`--layout-sidebar-width`, `--layout-header-height`, ...). These are constants in code, not per-theme tokens — a desktop tool has muscle memory.

**Why**: system integrity. Twelve one-off `p-3` calls will always drift; one `gap-4` invocation cannot. Radius that scales together makes the visual feel harmonic instead of assembled.

---

## What Cradle is not

- **Not a marketing site.** No hero gradients. No 4xl display type. No feature icons in circles floating on colored panels. If you find yourself designing a landing page inside Cradle, stop.
- **Not Material Design.** No floating cards, no ripples, no elevation-based visual hierarchy.
- **Not a bank dashboard.** No chart-heavy stat grids as decoration. Stats exist when the number matters, not to fill space.
- **Not a text editor.** Reading width is capped (`--layout-content-max-chat: 672px`, `--layout-content-max-wide: 896px`); we don't stretch content to the viewport.
- **Not skeuomorphic.** Surface texture is subtle — 1-px rings, hairline highlights. We do not render buttons that look like actual physical buttons.

---

## The invariants (the ten no-negotiate rules)

1. **Two-tone chrome** — chrome (`--color-sidebar`) is always dimmer than content (`--color-surface`).
2. **Floating card** — main content sits inside chrome with `--layout-gutter` margin, `--radius-xl` corners, `--shadow-sm`.
3. **Surface texture, not elevation** — inset shadows for depth; no `shadow-lg` on cards.
4. **Geist everywhere** — never hardcode font-family.
5. **Four text tiers, no opacity stacking** — pre-resolved tiers only.
6. **Spring physics for interactive motion** — no ease-in-out on state changes the user causes.
7. **Accent is semantic** — each color maps to a content category, never decorative.
8. **No gradients** — flat surfaces only. The onboarding brand ring is the single sanctioned exception.
9. **No uppercase tracking labels** — sentence case, always.
10. **Static Tailwind classes only** — never construct class names from variables.

If a design deviates from these ten, it's not Cradle — it's a different product wearing Cradle's clothes.

---

## Motion decision tree

```
Is the user causing the change?
├── Yes → Spring physics
│   ├── Panel / tab / accordion   → Default (600 / 40)
│   ├── Message entrance          → Message (500 / 35)
│   └── Panel navigation forward  → Drill-in (600 / 40, opacity + x + blur)
└── No  → CSS transition
    ├── Hover fill                → 120ms, --ease-standard
    ├── Icon swap                 → 200ms, --ease-standard, with 2px blur
    └── Non-motion state (color)  → 200ms, --ease-standard
```

Anything longer than 350ms should be justified in a comment.

---

## Color decision tree

```
Is this content marked with a category (workspace / agent / session / ...)?
├── Yes → Matching --color-accent-* at bg/10 + text/60~70
└── No  → Neutral
    ├── Body text          → --text-primary
    ├── Meta / timestamp   → --text-secondary
    ├── Chrome label       → --text-tertiary
    ├── Disabled / decor   → --text-dim
    ├── Content surface    → --color-surface
    ├── Chrome surface     → --color-sidebar
    ├── Hover fill         → --color-fill
    ├── Content border     → --color-border-content
    └── Chrome border      → --color-border-chrome
```

If the answer is "none of these" — you're either inventing decoration (stop) or missing a category token (open an issue).

---

## Density philosophy

Cradle is a **medium-density desktop tool**. Not spartan (Terminal), not spacious (Notion).

- Buttons live in `h-8` by default; `h-7` in compact contexts, `h-9` for prominent CTAs.
- Header is `h-11` (44px including the drag region), footer is `h-9` (36px).
- Body text is 13px (`text-[13px]`) — smaller than a web app, larger than an IDE.
- Row heights sit at 28–40px depending on context.

Density is not crampedness. It's respect for the user's screen real estate — a desktop tool that gives back the pixels it doesn't need.

---

## Read-order for new contributors

1. This file (`PHILOSOPHY.md`).
2. `CHEATSHEET.md` — the invariants and quick reference.
3. `references/tokens.md` — token rationale.
4. `references/compositions.md` — patterns that compose primitives into recognizable Cradle surfaces.
5. `references/anti-patterns.md` — what not to do, with before/after code.
6. `references/mockup-to-react.md` — HTML → React handoff.

If you skip 1 and 2, the rest reads as a style guide rather than a coherent language.
