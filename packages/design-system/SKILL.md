---
name: cradle-design-system
description: 'Cradle visual language contract. Read CHEATSHEET.md before every UI task. Use for mockups, components, handoff, and token audits.'
applyTo: 'apps/web/src/**/*.tsx, apps/desktop/src/**/*.tsx, packages/**/*.tsx, templates/**/*.html'
---

# Cradle Design System

Cradle's visual language — a modern, physics-native desktop AI environment.  
Between Linear and Vercel: precise, high-contrast, unsentimental.

## Step 1 · Identify the task

| User says | Task tier | Read |
|---|---|---|
| "make a mockup for X" | **New mockup** | `CHEATSHEET.md` + `references/tokens.md` + `references/anti-patterns.md` |
| "build component X" | **New React component** | `CHEATSHEET.md` + `references/components.md` + `references/anti-patterns.md` |
| "convert this mockup to React" | **Handoff** | `references/mockup-to-react.md` + `references/components.md` |
| "audit this file for token compliance" | **Token audit** | `references/anti-patterns.md` + `references/tokens.md` |
| "add animation to X" | **Motion** | `CHEATSHEET.md` (Animation section) |
| "review this design" | **Review** | `CHEATSHEET.md` + `references/anti-patterns.md` |

## Step 2 · Produce

- For **mockups**: start from `templates/scaffold.html`, drop in snippets from `templates/snippets/`
- For **React components**: import from `apps/web/src/components/ui/`, style with `cn()` + static Tailwind classes
- For **tokens**: all color vars in `src/tokens.css`; all design rules in `references/tokens.md`

## Step 3 · Verify

Run before shipping:
```bash
pnpm check   # token drift + template lint
```

If check fails, fix the source (`src/tokens.css` or template), never the artifact.

## When NOT to use this skill

- Backend, API, or server-side code
- Database schema or migration tasks
- Non-UI TypeScript utilities

## Language

Primary: English. All copy is English-first.
