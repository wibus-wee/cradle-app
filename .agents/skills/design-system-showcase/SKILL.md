---
name: design-system-showcase
description: 'Build a full design-system skill package with showcase site for a real project or brand. Produces: SKILL.md, CHEATSHEET.md, token CSS, reference docs (tokens, anti-patterns, components, mockup-to-react), HTML templates with snippets, a React+Vite showcase SPA, demo HTML→PDF pipeline, and TypeScript verification scripts. Triggers on "create a design system / extract visual language / build design tokens / make a showcase site / 做设计系统 / 提取视觉语言 / 生成 token".'
---

# Design System Showcase Skill

Create a portable design-system skill package and its showcase site from a real project, product, or brand. The output is an npm package: researched visual language, CSS tokens, a one-page cheatsheet, reference docs, HTML mockup templates, a React showcase SPA, demo HTML files with PDF exports, and TypeScript verification.

## Core Principles

- Start from real artifacts, not generic taste. Use official product pages, docs, repositories, screenshots, logos, decks, or user-provided materials.
- Keep `SKILL.md` procedural and lean — a task routing table, not a brochure. Put detailed design rules in `references/`.
- `CHEATSHEET.md` is the daily driver. Agents read it before every mockup or component task. Full rationale lives in `references/tokens.md`.
- Use progressive disclosure. Tell the agent exactly when to read each reference file.
- Generate assets only after the design language is documented. The showcase, templates, and demos must all consume the same `src/tokens.css`.
- Never invent brand facts, logos, screenshots, product UI, metrics, dates, or partnerships. Mark gaps or ask once.

## Target Repository Shape

```text
.
├── CHEATSHEET.md              # One-page quick reference (invariants, color table, typography, spacing, quick decisions)
├── LICENSE
├── README.md                  # Install + usage + verify
├── SKILL.md                   # Lean execution guide with task routing
├── package.json               # npm package: exports, scripts, devDependencies
├── references
│   ├── anti-patterns.md       # "What NOT to do" with code examples
│   ├── components.md          # Component catalog + selection rules
│   ├── mockup-to-react.md    # HTML→React translation table
│   └── tokens.md             # Full token spec with rationale and edge cases
├── scripts
│   ├── check.ts              # TypeScript lint: token drift, banned classes, raw hex
│   ├── check.test.ts         # Unit tests for check.ts
│   └── generate-pdfs.sh      # Headless Chrome PDF generation
├── showcase
│   ├── index.html            # Entry point (Google Fonts preconnect, mount React)
│   ├── public
│   │   ├── demos
│   │   │   ├── _shared.css          # Shared demo stylesheet
│   │   │   ├── demo-post.html       # Long-form post demo (zh)
│   │   │   ├── demo-post.en.html    # Long-form post demo (en)
│   │   │   ├── demo-post.pdf
│   │   │   ├── demo-post.en.pdf
│   │   │   ├── demo-resume.html     # Resume demo (zh)
│   │   │   ├── demo-resume.en.html
│   │   │   ├── demo-resume.pdf
│   │   │   ├── demo-resume.en.pdf
│   │   │   ├── demo-report.html     # One-page report demo (zh)
│   │   │   ├── demo-report.en.html
│   │   │   ├── demo-report.pdf
│   │   │   └── demo-report.en.pdf
│   │   └── favicon.svg
│   ├── src
│   │   ├── App.tsx                   # Root: Toolbar + sections
│   │   ├── i18n.ts                   # Bilingual support (zh/en)
│   │   ├── main.tsx                  # React entry
│   │   ├── styles.css                # Tailwind v4 entry + showcase CSS
│   │   ├── theme.ts                  # Theme toggle (light/dark, URL param + localStorage)
│   │   ├── sections
│   │   │   ├── Hero.tsx              # Project name, positioning, core token preview
│   │   │   ├── OutputSamples.tsx     # Demo cards with iframe preview + PDF download
│   │   │   ├── Manifesto.tsx         # Numbered invariants grid
│   │   │   ├── Color.tsx             # Neutral + accent + semantic swatches
│   │   │   ├── Typography.tsx        # Font roles + size scale
│   │   │   ├── Spacing.tsx           # Spacing + radius tiers
│   │   │   ├── Components.tsx        # Component catalog reference
│   │   │   ├── Snippets.tsx          # Live snippet demos
│   │   │   ├── AntiPatterns.tsx      # What NOT to do (visual)
│   │   │   ├── Decision.tsx          # Quick decision table
│   │   │   ├── Background.tsx        # Background / texture reference
│   │   │   └── Footer.tsx
│   │   └── snippets
│   │       ├── CodeBlock.tsx
│   │       ├── CommentThread.tsx
│   │       ├── Form.tsx
│   │       ├── Modal.tsx
│   │       └── Sheet.tsx
│   ├── tsconfig.json
│   └── vite.config.ts
├── src
│   └── tokens.css                    # Canonical Tailwind v4 @theme tokens
└── templates
    ├── scaffold.html                 # HTML scaffold with dark mode toggle + all tokens
    └── snippets
        ├── code-block.html
        ├── comment-thread.html
        ├── form.html
        ├── hero.html
        ├── list-card.html
        ├── logo.html
        ├── modal.html
        ├── sheet.html
        └── stat-grid.html
```

Add only the files that serve the skill or the showcase. Do not add installation guides, quickstart docs, or process notes unless explicitly asked.

## Bundled Assets

This skill includes ready-to-use files. Copy or adapt them into the target project instead of generating equivalents from scratch.

| Bundled file | Copy to target | Notes |
|---|---|---|
| `scripts/check.ts` | `scripts/check.ts` | Copy verbatim — no modification needed |
| `scripts/check.test.ts` | `scripts/check.test.ts` | Copy verbatim |
| `scripts/generate-pdfs.sh` | `scripts/generate-pdfs.sh` | Copy, then update the `DEMOS` array at the top |
| `templates/scaffold.html` | `templates/scaffold.html` | Copy, then replace all token hex values in `:root` |
| `templates/showcase/vite.config.ts` | `showcase/vite.config.ts` | Copy verbatim |
| `templates/showcase/main.tsx` | `showcase/src/main.tsx` | Copy verbatim |
| `templates/showcase/i18n.ts` | `showcase/src/i18n.ts` | Copy, then replace `dict` entries with project copy |
| `templates/showcase/theme.ts` | `showcase/src/theme.ts` | Copy verbatim |
| `templates/showcase/package.json` | `package.json` | Copy, then fill in `@SCOPE`, `DESCRIPTION` |
| `templates/showcase/styles.css` | `showcase/src/styles.css` | Copy, then fill in `CUSTOMIZE` blocks |

Read `references/cheatsheet-format.md` before writing the project's `CHEATSHEET.md`.
Read `references/design.spec.md` for the DESIGN.md token format specification when writing `references/design.md`.

## Workflow

### Step 1 · Scope the System

Identify the subject and intended outputs.

Record:

- Project name and one-line positioning
- Primary audience
- Supported languages (default: Chinese-first with English)
- Color system: palette source, naming convention (e.g., Japanese 和色)
- Typography: font roles (sans/serif/mono), CJK fallback requirement
- Distribution: monorepo package, standalone repo, or both

If scope is ambiguous, choose a minimal default:

- `SKILL.md` + `CHEATSHEET.md`
- `src/tokens.css`
- `references/tokens.md` + `references/anti-patterns.md`
- `templates/scaffold.html` + 3 snippets
- `scripts/check.ts`
- `showcase/` (Hero + Color + OutputSamples sections minimum)
- One demo: `showcase/public/demos/demo-post.html` + PDF
- `package.json` + `README.md`

### Step 2 · Gather Source Material

Use primary sources first:

- Official website and docs
- Product screenshots or user-provided captures
- Existing logo, icons, fonts, and brand files
- Repository source code (especially existing CSS/Tailwind config)
- Real output samples from the product

Create a short source ledger in working notes before writing design rules:

```markdown
| Source | Type | Date checked | Useful facts | Gaps |
|---|---|---:|---|---|
| [Name](URL) | Official site | YYYY-MM-DD | Logo, tone, color palette | No typography specs |
```

Source rules:

- Current facts such as versions, prices, funding, metrics, launches, and market claims must be checked.
- If sources conflict, use the most official source or ask the user once.
- If a logo, UI screenshot, or product image is missing, mark it as a gap. Do not draw an approximate logo.

### Step 3 · Extract the Design Language

Convert the research into a constraint system. Produce three outputs:

#### 3a. `src/tokens.css` — Canonical Tailwind v4 tokens

```css
@theme {
  --color-accent: #...;
  --color-neutral-1: #...;
  /* ... through --color-neutral-10 */
  --color-info: #...;
  --color-success: #...;
  --color-warning: #...;
  --color-error: #...;
  --color-border: rgba(...);
  --font-sans: ...;
  --font-serif: ...;
  --font-mono: ...;
}
```

#### 3b. `CHEATSHEET.md` — One-page quick reference

Read `references/cheatsheet-format.md` for the exact structure, section order, and parser-critical formatting rules before writing this file.

1. **Invariants** — 8–12 numbered rules (the core contract)
2. **Color** — Neutral table (var, hex, tier, use) + accent + semantic
3. **Typography** — Font stack vars + size/use table
4. **Spacing & radius** — Gap tier table + radius table
5. **Backdrop blur** (if applicable) — Level table
6. **Quick decisions** — "Need X → use Y" lookup table
7. **Verification** — the `check` command and what it validates

Every hex in the cheatsheet must match `src/tokens.css`. The verify script enforces this.

#### 3c. `references/tokens.md` — Full spec with rationale

Deep dive on every token group: the WHY behind each value, dark mode behavior, edge cases, and the reasoning the cheatsheet condenses away.

### Step 4 · Write Reference Docs

Read `references/design.spec.md` for the DESIGN.md token format specification.

#### `references/anti-patterns.md`

Structure by category (Color, Typography, Layout, Components, Process). Each anti-pattern shows:

1. Wrong code example
2. Right code example
3. Why it matters

Cover at minimum:

- Banned Tailwind default classes (e.g., `neutral-50…950`)
- N-5 misuse as text color
- Raw hex outside the contract
- Accent overuse
- Synthetic bold on CJK
- Hardcoded font-family
- Hard drop shadows
- Skipping the cheatsheet

#### `references/components.md`

- Inventory of existing UI primitives (file tree)
- Selection rules: Modal vs Dialog vs Sheet, Button vs Link vs Tag
- Rules for adding a new UI entry
- Import conventions

#### `references/mockup-to-react.md`

- General rules (structure first, no new tokens during handoff)
- Mapping table: HTML mockup pattern → React component
- Handoff steps (1–5)
- What to do when the mapping table is silent

### Step 5 · Define the Output SKILL.md

The generated project's `SKILL.md` is an execution guide with a task routing table:

```markdown
## Step 1 · Identify the task

| User says | Task tier | Read |
|---|---|---|
| "make a mockup for X" | **New mockup** | `CHEATSHEET.md` + `references/tokens.md` + `references/anti-patterns.md` |
| "build component X" | **New React component** | `CHEATSHEET.md` + `references/components.md` + `references/anti-patterns.md` |
| "convert this mockup to React" | **Handoff** | `references/mockup-to-react.md` + `references/components.md` |
| "audit this file for token compliance" | **Token audit** | `references/anti-patterns.md` + `references/tokens.md` |
```

Follow with Step 2 (Produce) and Step 3 (Verify) — procedural, not descriptive.

End with a "When NOT to use this skill" section and a "Languages" note.

### Step 6 · Build Templates

#### `templates/scaffold.html`

Copy `templates/scaffold.html` from this skill to the target project, then replace every hex value in `:root` with your project's actual token values (from `src/tokens.css`). The structure, dark mode block, and toolbar are complete and need no other changes.

#### `templates/snippets/`

Reusable HTML sections that use only token vars. Minimum set:

- `hero.html` — hero section with title, tagline, CTA
- `list-card.html` — card grid or list
- `form.html` — form with input, label, button
- `modal.html` — dialog overlay
- `sheet.html` — bottom/side sheet
- `code-block.html` — syntax-highlighted code
- `stat-grid.html` — metrics/stats layout
- `comment-thread.html` — comment UI
- `logo.html` — brand mark (if applicable)

Each snippet must:
- Use only `var(--color-...)`, `var(--font-...)` — no raw hex
- Work inside `scaffold.html` without modification
- Be self-contained (no external dependencies beyond the scaffold's `<style>`)

### Step 7 · Build the Showcase

The showcase is a React + Vite SPA that proves the system by displaying real outputs.

#### `package.json`

```json
{
  "name": "@[scope]/design-system",
  "type": "module",
  "exports": {
    "./tokens.css": "./src/tokens.css",
    "./skill": "./SKILL.md",
    "./cheatsheet": "./CHEATSHEET.md"
  },
  "scripts": {
    "check": "tsx scripts/check.ts",
    "test": "tsx --test scripts/check.test.ts",
    "showcase:dev": "vite --config showcase/vite.config.ts",
    "showcase:build": "vite build --config showcase/vite.config.ts",
    "showcase:preview": "vite preview --config showcase/vite.config.ts",
    "demo:pdf": "bash scripts/generate-pdfs.sh"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.1.0",
    "tsx": "^4.19.0",
    "typescript": "^6.0.0",
    "vite": "^8.0.0"
  }
}
```

#### Showcase sections (in order)

| Section | Component | Purpose |
|---|---|---|
| Hero | `Hero.tsx` | Project name, positioning, core token preview (accent hex, neutral range, font stacks) |
| Output Samples | `OutputSamples.tsx` | Demo cards: iframe preview of demo HTML at scaled viewport + PDF download link |
| Manifesto | `Manifesto.tsx` | Numbered invariants grid (from CHEATSHEET.md) |
| Color | `Color.tsx` | Swatch grid: neutral 1–10, accent, semantics. Each swatch shows chip + name + role + hex |
| Typography | `Typography.tsx` | Font role display + size scale table |
| Spacing | `Spacing.tsx` | Gap tier + radius tier visual |
| Components | `Components.tsx` | UI primitive catalog reference |
| Snippets | `Snippets.tsx` | Live rendered snippet demos (CodeBlock, Form, Modal, Sheet, CommentThread) |
| Anti-Patterns | `AntiPatterns.tsx` | Visual do/don't comparisons |
| Decision | `Decision.tsx` | Quick decision lookup table |
| Background | `Background.tsx` | Background/texture/surface reference |
| Footer | `Footer.tsx` | Credits, links |

#### Showcase infrastructure

Copy these files from the bundled `templates/showcase/` directory:

- `vite.config.ts` → `showcase/vite.config.ts` (verbatim)
- `main.tsx` → `showcase/src/main.tsx` (verbatim)
- `theme.ts` → `showcase/src/theme.ts` (verbatim)
- `i18n.ts` → `showcase/src/i18n.ts`, then replace all `dict` entries with project-specific copy
- `styles.css` → `showcase/src/styles.css`, then fill in all `/* CUSTOMIZE */` blocks
- `package.json` → `package.json`, then fill in `@SCOPE` and `DESCRIPTION`

Add `showcase/index.html` (not bundled — must be written per project):

```html
<!doctype html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>[Project] · Design System</title>
    <meta name="description" content="[One-line description]" />
    <!-- Add Google Fonts preconnect + stylesheet links here -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

#### Demo files

At minimum 3 demo types in `showcase/public/demos/`:

| Demo | Subject | Format |
|---|---|---|
| `demo-post` | Long-form article/post | Multi-page, serif body, drop cap |
| `demo-resume` | One-page resume/CV | A4, compact, professional |
| `demo-report` | Project status report | A4, stat grid, charts |

Each demo has 4 variants: `{name}.html`, `{name}.en.html`, `{name}.pdf`, `{name}.en.pdf`.

All demo HTML files import `_shared.css` which sources tokens from `src/tokens.css`.

### Step 8 · Write Verification Scripts

Copy `scripts/check.ts`, `scripts/check.test.ts`, and `scripts/generate-pdfs.sh` from this skill to the target project's `scripts/` directory.

**`scripts/check.ts`** — copy verbatim. It reads `src/tokens.css`, `CHEATSHEET.md`, and `templates/` from the project root, so no path changes are needed.

**`scripts/check.test.ts`** — copy verbatim.

**`scripts/generate-pdfs.sh`** — copy, then update the `DEMOS` array at the top to list your demo base names:

```bash
DEMOS=(
  "demo-post"
  "demo-resume"
  "demo-report"
)
```

All three scripts are self-contained and require no other modifications.

### Step 9 · Verify and Iterate

Run validation before shipping:

```bash
# Lint token drift + template compliance
pnpm check         # or: tsx scripts/check.ts

# Unit tests for the check script
pnpm test          # or: tsx --test scripts/check.test.ts

# Generate PDFs from demo HTML
pnpm demo:pdf      # or: bash scripts/generate-pdfs.sh

# Build showcase for deployment
pnpm showcase:build
```

Checks to enforce:

- **Token drift**: every hex in `CHEATSHEET.md` matches `src/tokens.css`
- **Banned classes**: no `text-neutral-50…950` in templates
- **Raw hex**: no literal hex (except `#fff`/`#000`) in inline styles
- **Font contract**: no hardcoded `font-family` — use `var(--font-*)`
- **CJK fallback**: every font stack includes CJK families
- **PDF generation**: all demo HTML produces valid PDF

If a check fails, fix the source (token CSS or template), not the exported artifact.

## Gotchas

- A showcase without real demo assets is not convincing. Create at least one complete demo flow (HTML → PDF).
- A skill with only design adjectives is weak. Convert taste into tokens, invariants, code examples, and automated checks.
- The CHEATSHEET.md and `src/tokens.css` are the two sources of truth. Everything else derives from them. If they disagree, the verify script must catch it.
- CJK typography needs special attention: no synthetic bold, mandatory fallback chains, `font-medium` (500) cap.
- Demo PDFs expose small CSS mistakes. Avoid alpha badge backgrounds, hard shadows, unsupported browser-only layout tricks, and missing font fallbacks.
- Logo fonts (`--font-logo-*`) are separate from body fonts (`--font-sans/serif/mono`). Never mix them.
- The showcase SPA must consume the same `src/tokens.css` as the templates. One contract, one source.
- Do not use Python for verification — use TypeScript (`tsx`) to stay in one toolchain.
- Large or licensed fonts may belong in the repository for local preview but not in the distributable package.

## Delivery Checklist

- [ ] `SKILL.md` has accurate frontmatter and task routing table
- [ ] `CHEATSHEET.md` captures invariants, color/type/spacing tables, quick decisions, verify command
- [ ] `src/tokens.css` declares all tokens as Tailwind v4 `@theme`
- [ ] `references/tokens.md` provides full rationale for every token group
- [ ] `references/anti-patterns.md` lists wrong/right code pairs by category
- [ ] `references/components.md` catalogs UI primitives with selection rules
- [ ] `references/mockup-to-react.md` provides a complete mapping table
- [ ] `templates/scaffold.html` contains all token vars + dark mode + toolbar
- [ ] `templates/snippets/` has at least 5 reusable HTML sections
- [ ] `scripts/check.ts` validates token drift + template compliance
- [ ] `scripts/check.test.ts` has passing unit tests
- [ ] `scripts/generate-pdfs.sh` produces PDFs from demo HTML
- [ ] `showcase/` builds successfully with Vite and renders all sections
- [ ] `showcase/public/demos/` has at least 1 demo type (zh + en + PDF)
- [ ] `package.json` has correct exports, scripts, and devDependencies
- [ ] `README.md` explains install, usage (CSS import), package structure, and verify command
