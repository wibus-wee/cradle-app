# Worktree Module

Cradle-owned session isolation via git worktrees. Worktrees are backend plumbing for sessions; they do not appear as sidebar workspaces.

**Design:** [ISOLATION-DESIGN.md](./ISOLATION-DESIGN.md) — storage in Application Support, Cursor-aligned lifecycle, reconciliation for deleted checkouts.

## Files

- `index.ts`: global managed worktree settings routes and workspace-scoped worktree lifecycle routes
- `model.ts`: TypeBox schemas
- `service.ts`: clean-source preflight, explicit branch-base resolution, compensated create/bind/cleanup, execution root resolution, issue isolation context, and cached low-priority `du` storage measurement registered with Maintenance and Background Activity. Automatic measurement checks every 15 minutes, requires no active/pending chat run and at most 5% Server CPU, and only scans worktrees whose measurement is at least six hours old. Explicit manual runs bypass those gates and measure every active worktree.

Session isolation routes live in `modules/session/index.ts`. Issue isolation context lives in `modules/issue/index.ts`.

## Routes

- `GET /workspaces/:workspaceId/worktrees`
- `POST /workspaces/:workspaceId/worktrees` creates a checkout. Optional `.cradle/worktrees.json` setup hooks are skipped unless the request includes `confirmedSetupHooks: true` or the workspace already has a stored setup-hook trust grant; hooks are always skipped while relay host enrollments expose the server.
- `POST /workspaces/:workspaceId/worktrees/:worktreeId/cleanup`
- `GET /worktrees/managed`
- `POST /worktrees/cleanup`
