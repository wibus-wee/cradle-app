# Reopen the last closed surface

- **Date:** 2026-08-31
- **Problem:** Closing a surface was immediate and irreversible, so an accidental keyboard close interrupted navigation and forced users to find the same chat, Work item, or workspace again.
- **Motivation:** Surface tabs are a primary daily navigation model; their destructive keyboard action needs a fast, familiar recovery path.
- **Product behavior:** `Cmd/Ctrl+Shift+T` restores the most recently user-closed surface once. While recovery is available, the command palette also shows **Reopen closed surface** with the surface title. Opening that surface another way consumes the recovery target.
- **Implementation:** The surface store owns one non-persisted `lastClosedSurface`. The user-facing close command records it before removal, while workspace deletion continues using the lower-level close operation and never records invalid resources. Surface sync clears a matching recovery target.
- **Systems affected:** Surface navigation state and commands, global shortcuts, command palette, shortcut/search translations, and navigation coverage.
- **Validation:** Targeted Vitest coverage, web typecheck, targeted ESLint, locale JSON parsing, and diff whitespace checks.
- **Tradeoffs:** Recovery retains one surface only and does not restore split panes or terminated terminal processes. It intentionally expires on reload.
- **Follow-up ideas:** Consider a bounded closed-surface history only if repeated recovery is common in dogfooding.
- **Out of scope:** Persistent history, resource resurrection after workspace deletion, split-layout restoration, and terminal process restoration.
