# CHEATSHEET.md Format

This file defines the structure and content of the `CHEATSHEET.md` that every design-system package must include.

`CHEATSHEET.md` is the daily driver for agents and developers. It is read before every mockup task, component build, and token audit. It must be:

- **One page** — scannable, not exhaustive. Deep rationale goes in `references/tokens.md`.
- **Sync-verified** — every hex value listed here must match `src/tokens.css`. The `pnpm check` script enforces this automatically.
- **Actionable** — every entry answers a real "what do I use?" question.

---

## Required Sections (in order)

### 1. Invariants

8–12 numbered rules that form the core contract. These are the things an agent must know before touching any file.

Focus on: what is banned, what is capped, what is the default.

```markdown
## Ten invariants

1. Neutrals are three-tier: 1–4 surface/fill, 5–7 border/icon/secondary text, 8–10 body/heading.
2. n-5 must never be used for text. n-6 only for small text. n-7 for secondary text.
3. Tailwind's `neutral-50…950` palette is banned. Use `text-neutral-1…10` only.
4. Accent covers ≤ 5% of any surface. Reserved for CTA, focus ring, and brand mark.
5. Default body color is n-9 (dark mode auto-inverts).
6. Three font roles only: sans, serif, mono. CJK fallback is mandatory.
7. [project-specific invariant]
8. Border radius follows Tailwind defaults; `rounded-2xl` is the cap for hero surfaces.
9. Depth comes from ring or whisper shadow. Hard drop shadows are forbidden.
10. Mockup HTML files must declare token vars in `:root`. Raw hex outside the contract is a lint failure.
```

### 2. Color tables

Three sub-tables: Neutral, Accent, Semantic.

Each row must have: CSS var name (backtick-quoted), hex (backtick-quoted), tier/category label, usage note.

**The hex column drives the verify script.** Use exactly the format `` `--color-neutral-1` `` and `` `#f9f8f5` `` — backtick-quoted, no spaces inside.

```markdown
## Color

### Neutral

| Var | Hex | Tier | Use |
|---|---|---|---|
| `--color-neutral-1` | `#f9f8f5` | 1 (surface) | Page background light, lightest fills |
| `--color-neutral-2` | `#f0efeb` | 1 (surface) | Card background |
...
| `--color-neutral-5` | `#a8a69f` | 2 (border) | Border on solid surfaces. **Never text.** |
...
| `--color-neutral-9` | `#24231f` | 3 (body) | **Default body color** |
| `--color-neutral-10` | `#141312` | 3 (heading) | Headings, max emphasis |

### Accent and semantic

| Var | Hex | Use |
|---|---|---|
| `--color-accent` | `#c56473` | CTA, focus, brand mark, blockquote bar. ≤ 5% surface. |
| `--color-info`   | `#3d6896` | Informational state |
| `--color-success`| `#5e9f7e` | Success state |
| `--color-warning`| `#a87a3d` | Warning state |
| `--color-error`  | `#a64953` | Error / destructive state |
```

### 3. Typography

Two parts: font stack vars (prose), then a size/use table.

```markdown
## Typography

\`\`\`css
--font-sans:  [font stack with CJK fallback]
--font-serif: [font stack with CJK fallback]
--font-mono:  [font stack with CJK fallback]
\`\`\`

| Tailwind class | Size | Use |
|---|---|---|
| `text-xs`   | 0.75rem  | Tiny labels |
| `text-sm`   | 0.875rem | Captions, secondary UI text |
| `text-base` | 1rem     | UI default |
| `text-lg`   | 1.125rem | Lead paragraph |
| `text-xl`   | 1.25rem  | Section title |
| `text-2xl`  | 1.5rem   | H2 |
| `text-3xl`  | 1.875rem | H1 on content pages |
| `text-4xl`  | 2.25rem  | Hero title |
```

### 4. Spacing & radius

Two tables: gap tiers, radius tiers.

```markdown
## Spacing & radius

| Tier | Use |
|---|---|
| `gap-1` (4px)  | inline icon ↔ text |
| `gap-2` (8px)  | tight stacks |
| `gap-3` (12px) | card content |
| `gap-4` (16px) | section content |
| `gap-6` (24px) | between cards in a grid |
| `gap-8` (32px) | major section breaks |

Radius: `rounded` (4px) chips, `rounded-md` (6px) default, `rounded-lg` (8px) cards,
`rounded-xl` (12px) modals, `rounded-2xl` (16px) hero cap.
```

### 5. Quick decisions

A lookup table mapping "I need X" to "use Y". This is the highest-frequency section — make it exhaustive for the common cases.

```markdown
## Quick decisions

| Need | Use |
|---|---|
| Body paragraph | `text-neutral-9` |
| Secondary text | `text-neutral-7` |
| Small caption  | `text-neutral-6 text-sm` |
| Heading        | `text-neutral-10 font-medium` |
| Card           | `bg-neutral-2 rounded-lg p-4 ring-1 ring-border` |
| Primary CTA    | accent fill, white text |
| Secondary button | `bg-neutral-2 hover:bg-neutral-3 text-neutral-9 ring-1 ring-border` |
| Tag / chip     | `bg-neutral-2 text-neutral-7 text-xs px-2 py-0.5 rounded-md` |
| Code block     | `bg-neutral-1 ring-1 ring-border rounded-md font-mono text-sm` |
| Blockquote     | left border accent, `text-neutral-7` |
| Section divider| `1px solid var(--color-border)` or `bg-neutral-3 h-px` |
```

### 6. Verification

End with the command and what it validates.

```markdown
## Verification

\`\`\`bash
pnpm check
\`\`\`

Validates:
1. Every hex in this cheatsheet matches `src/tokens.css`.
2. No `templates/**/*.html` uses `text-neutral-50…950` or raw hex outside the contract.
3. Every template's font-family declarations go through `var(--font-*)`.
```

---

## Anti-patterns to avoid in the cheatsheet itself

- Do not list hex values that differ from `src/tokens.css` — the verify script will fail.
- Do not add prose rationale here — that belongs in `references/tokens.md`.
- Do not add workarounds, exceptions, or "unless..." clauses. Keep it clean.
- Do not omit the backtick quoting on var names and hex values — the parser depends on it.
