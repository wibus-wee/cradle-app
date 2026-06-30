# @cradle/design-system

Cradle's visual language — tokens, AI-readable contract, and HTML mockup templates.

## Install

```bash
pnpm add @cradle/design-system
```

## Usage

```css
@import "@cradle/design-system/tokens.css";
```

## What's included

| Path | Contents |
|---|---|
| `src/tokens.css` | CSS custom properties — neutral scale, accents, fonts |
| `CHEATSHEET.md` | One-page quick reference for every design decision |
| `SKILL.md` | AI-readable skill for design tasks |
| `references/tokens.md` | Full token specification with rationale |
| `references/anti-patterns.md` | What NOT to do — with before/after examples |
| `references/components.md` | Available UI components and selection rules |
| `references/mockup-to-react.md` | HTML → React handoff translation table |
| `templates/scaffold.html` | Mockup scaffold with all tokens pre-wired |
| `templates/snippets/` | 8 ready-to-use HTML snippet fragments |
| `showcase/` | Vite+React showcase SPA |

## Verify

```bash
pnpm check
```

Checks:
- Every hex in `CHEATSHEET.md` matches `src/tokens.css`
- No banned Tailwind neutral classes in templates
- No raw hex in inline style attributes

Run tests:

```bash
pnpm test
```

## Showcase

```bash
pnpm showcase:dev
```

Opens at `http://localhost:5173` — full design system reference with live token display, typography scale, component catalog, and anti-pattern examples.

## Generate PDFs

```bash
pnpm demo:pdf
```

Generates PDFs from demo HTML files using headless Chrome. Requires Chrome installed.
