# Token Reference

Full specification and rationale for every token group in the Cradle design system.

---

## 1. Neutral Scale

### Why 10 tiers?

Cradle uses a custom 10-tier neutral scale rather than Tailwind's built-in `neutral-50…950`. The reasons:

1. **Semantic mapping**: each tier maps directly to a usage role (surface, chrome, fill, border, text tiers), eliminating guesswork
2. **Dark mode inversion**: tiers 1..10 invert cleanly in dark mode (1↔10, 2↔9, etc.), making dark mode a mechanical transformation
3. **Fewer tokens, more meaning**: 10 named tiers vs 22 Tailwind steps — every tier is justified

### Mapping from Tailwind neutral

| Cradle tier | Hex (light) | Tailwind ~equiv | Role |
|---|---|---|---|
| neutral-1 | `#ffffff` | white | Content surface, page background |
| neutral-2 | `#f5f5f5` | neutral-100 | Chrome: sidebar, header, footer |
| neutral-3 | `#ebebeb` | neutral-200 | Hover fill, subtle surface |
| neutral-4 | `#d4d4d4` | neutral-300 | Strong fill, dividers |
| neutral-5 | `#a3a3a3` | neutral-400 | Ring/border indicator — **never as text** |
| neutral-6 | `#737373` | neutral-500 | Secondary text, muted foreground |
| neutral-7 | `#595959` | neutral-600 | Chrome foreground, tertiary text |
| neutral-8 | `#404040` | neutral-700 | Strong secondary |
| neutral-9 | `#262626` | neutral-800 | Primary body text, CTA background |
| neutral-10 | `#141414` | neutral-900 | Dark mode bg, max emphasis headings |

### Dark mode inversion strategy

Dark mode inverts the neutral scale symmetrically:

| Light | Dark |
|---|---|
| neutral-1 (#ffffff) | neutral-10 (#141414) |
| neutral-2 (#f5f5f5) | neutral-9 (#111111) — slightly bluer than #262626 |
| neutral-3 (#ebebeb) | neutral-8 (#1a1a1a) |
| neutral-4 (#d4d4d4) | neutral-7 (#2a2a2a) |
| neutral-5 (#a3a3a3) | neutral-6 (#404040) |
| neutral-6 (#737373) | neutral-5 (#8a8a8a) |
| neutral-7 (#595959) | neutral-4 (#a3a3a3) |
| neutral-8 (#404040) | neutral-3 (#d4d4d4) |
| neutral-9 (#262626) | neutral-2 (#f5f5f5) |
| neutral-10 (#141414) | neutral-1 (#ffffff) |

**Note**: dark mode neutral-2 is `#111111` (not `#262626`). Cradle's dark chrome is blacker than a pure gray inversion — this gives the characteristic two-tone look where the sidebar/header reads as distinct from content.

---

## 2. Accent Color System

### Rationale: semantic, not decorative

Each accent in Cradle maps to a specific **content category**. Accents are not used for decoration (gradient backgrounds, colored borders without meaning). Using the wrong accent on the wrong content type breaks the visual language.

| Token | Hex | Semantic category | Where used |
|---|---|---|---|
| `--color-accent` | `#3b82f6` | Workspace (default) | Active workspace indicator, workspace-scoped badges |
| `--color-accent-session` | `#8b5cf6` | Session / Builtin | Built-in agent session badges, session scope icons |
| `--color-accent-global` | `#0ea5e9` | Global | Global scope indicators, cross-workspace references |
| `--color-accent-scope` | `#10b981` | Workspace scope / Doc | Document scope badges, scope selector chips |
| `--color-accent-agent` | `#f43f5e` | Agent | Agent status indicators, agent-generated content markers |
| `--color-accent-legacy` | `#f59e0b` | Legacy | Legacy content warnings, compatibility indicators |
| `--color-accent-diff` | `#f97316` | Diff | Diff views, change indicators |
| `--color-accent-summary` | `#ec4899` | Summary | Summary/digest content, highlight extracts |

### Usage pattern for accents

```tsx
// Category badge: 10% bg opacity, full color text
<span className="bg-blue-500/10 text-blue-600 rounded-full px-2 py-0.5 text-xs">
  Workspace
</span>

// Never: solid accent background on non-interactive elements
// Never: accent color used as body text color
// Never: two accent colors on the same element
```

---

## 3. Text Hierarchy

Cradle uses 4 pre-resolved text tiers. **Never add opacity modifiers on top of text tokens** — opacity stacking creates gray mud and breaks dark mode contrast.

| Tier | Token | Light hex | Use | WCAG contrast (on neutral-1) |
|---|---|---|---|---|
| Primary | `--color-neutral-9` | `#262626` | Body copy, labels, headings | ~14:1 |
| Secondary | `--color-neutral-6` | `#737373` | Meta, timestamps, secondary info | ~4.5:1 (AA) |
| Tertiary | `--color-neutral-7` | `#595959` | Chrome labels, placeholder text | ~6.2:1 (AA) |
| Dim/disabled | `--color-neutral-5` | `#a3a3a3` | Disabled state, decorative only | ~2.7:1 — do not use for readable text |

**Rule**: pick the tier, do not modify it. No `/70`, `/80` suffix on text classes.

---

## 4. Typography Scale

### Font choice: Geist Variable

Geist Variable is chosen for:
- **Variable font**: single file covers all weights 100–900 without loading multiple font files
- **Optical metrics**: designed for UIs at 11–18px, not editorial at 24px+
- **Linear/Vercel lineage**: familiar to users of modern developer tools
- **Mono companion**: Geist Mono shares vertical metrics with Geist, so code blocks don't shift layout

### Scale rationale

| Role | Size | Weight | Use |
|---|---|---|---|
| Display | 30px | 600 | Page titles, onboarding headers — used sparingly |
| Heading | 18px | 600 | Section headings, modal titles |
| Section title | 16px | 600 | Subsection headers, panel titles |
| Body lg | 14px | 400 | Primary reading text, descriptions |
| Body md | 13px | 400 | Default text in UI — most common |
| Body sm | 12px | 400 | Secondary info, list metadata |
| Label md | 13px | 500 | Button text, form labels — medium weight |
| Label sm | 12px | 500 | Small chips, tab labels |
| Caption | 11px | 400 | Timestamps, footnotes, tooltips |
| Code sm | 11px | 400 | Inline code, terminal output |
| Code xs | 10px | 400 | Dense code contexts (diff views) |

**Note**: the scale stops at 30px (display). No `text-4xl` or larger — Cradle is a desktop app UI, not a marketing site.

---

## 5. Spacing Scale

| Token | Value | Tailwind class | Use |
|---|---|---|---|
| xs | 4px | `gap-1`, `p-1` | Icon-to-label gap, tight row padding |
| sm | 8px | `gap-2`, `p-2` | List row inner padding, inline gaps |
| md | 16px | `gap-4`, `p-4` | Section padding, standard component gap |
| lg | 24px | `gap-6`, `p-6` | Card padding, section gap |
| xl | 32px | `gap-8`, `p-8` | Page section padding |
| 2xl | 64px | `gap-16`, `p-16` | Major section separation |

**Rule**: use the scale tokens, not arbitrary values. `p-3` (12px) is acceptable for intermediate cases but should not be the default.

---

## 6. Border Radius Scale

| Token | Value | Class | Use |
|---|---|---|---|
| sm | 6px | `rounded` | Small chips, inline tags, tight controls |
| md | 8px | `rounded-lg` | Buttons, inputs, selects |
| base | 10px | `rounded-xl` | Cards, panels, dropdowns |
| lg | 12px | `rounded-2xl` | Popovers, modals |
| xl | 16px | `rounded-3xl` | Large content cards, floating panels |
| full | 9999px | `rounded-full` | Pills, avatars, badges |

**Note**: Cradle uses slightly larger radii than typical SaaS apps (10px base vs 6px). This is intentional — it reads as "modern and approachable" without being "bubbly."

---

## 7. Shadow System: Surface Texture vs Elevation

### Philosophy

Cradle does NOT use shadows to suggest elevation (the "floating card" look popular in Material Design). Instead, shadows provide **surface texture** — a subtle physical feel that makes surfaces feel tangible rather than flat.

### Shadow tokens

| Name | Value | Use |
|---|---|---|
| xs | `0 1px 2px oklch(0 0 0 / 0.04), 0 0 0 1px oklch(0 0 0 / 0.05)` | Inputs, small controls — barely visible ring |
| sm | `0 1px 3px oklch(0 0 0 / 0.08), 0 0 0 1px oklch(0 0 0 / 0.06)` | Cards, panels — light boundary definition |
| md | `0 4px 16px -2px oklch(0 0 0 / 0.10), 0 2px 4px -1px oklch(0 0 0 / 0.06)` | Modals, popovers — slight presence lift |

### Inset shadow for depth

For interactive state changes (pressed buttons, focused inputs), use `inset-shadow` to push surfaces inward rather than pulling them up:

```css
/* Button pressed state */
box-shadow: inset 0 1px 2px oklch(0 0 0 / 0.12);

/* Focused input */
box-shadow: inset 0 0 0 1px var(--color-accent), 0 0 0 3px var(--color-accent)/0.15;
```

**Never**: `shadow-md` or `shadow-lg` on interactive elements — this makes them look like they're levitating.

---

## 8. Animation Tokens

### Spring physics rationale

Linear or ease-in-out transitions feel mechanical for interactive UI. Spring physics gives motion a physical quality — slight overshoot, natural deceleration — that makes interactions feel more alive without being distracting.

| Token | Stiffness | Damping | Duration range | Use |
|---|---|---|---|---|
| Spring default | 600 | 40 | ~200ms | Tab switches, accordion, panel toggles |
| Spring message | 500 | 35 | ~250ms | Message list entrance (opacity + y) |
| Panel drill-in | 600 | 40 | ~200ms | Navigation forward (opacity + x + blur) |

### Implementation with Framer Motion

```tsx
// Default spring — tab/panel transitions
const spring = { type: 'spring', stiffness: 600, damping: 40 }

// Message entrance
const messageSpring = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
}

// Panel drill-in
const drillIn = {
  type: 'spring',
  stiffness: 600,
  damping: 40,
  initial: { opacity: 0, x: 20, filter: 'blur(4px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
}
```

---

## 9. Border Opacity Strategy

Cradle uses **opacity-based borders** rather than color token borders. This ensures borders remain perceptible in both light and dark mode without defining separate dark-mode border tokens.

| Surface | Border value | Tailwind |
|---|---|---|
| Content surface (cards, inputs) | `rgba(0,0,0,0.08)` | `border-black/8` |
| Chrome (sidebar, header) | `rgba(0,0,0,0.06)` | `border-black/6` |
| Dark mode content | `rgba(255,255,255,0.06)` | `border-white/6` |
| Dark mode chrome | `rgba(255,255,255,0.05)` | `border-white/5` |

**Never use**: `border-neutral-200`, `border-gray-300`, or `border-border` with a hardcoded neutral step — these break dark mode inversion.

---

## 10. Layout Constants

These are fixed values, not design tokens — they don't vary between themes.

| Constant | Value | Description |
|---|---|---|
| Sidebar width | 260px | Expanded sidebar |
| Sidebar collapsed | 48px | Icon-only mode |
| Header height | 40px | App-level header / tab bar |
| Footer height | 36px | Status bar / footer chrome |
| Content max (chat) | 672px | Comfortable reading width for chat |
| Content max (wide) | 896px | Wider content (docs, settings, panels) |
