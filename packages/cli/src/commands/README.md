<!-- Once this directory changes, update this README.md -->

# Commands

Generated command modules for Cradle CLI.

## Files

- **generated/**: OpenAPI-derived command files refreshed by `pnpm gen:cli`
- **open.ts**: `cradle open [path]` plus path sugar (`cradle .`) — ensure a directory is registered as a workspace and open it in Desktop via `cradle://open/workspace?id=...`
- **session-await.ts**: Manual task-shaped `cradle session await ...` wrapper for GitHub CI, GitHub review, manual waits, and delivery retry; raw generated `session await-*` commands remain available as an escape hatch
- **plugin-dev.ts**: Long-running `cradle plugin dev` command; uses Vite watch builds, maintains an ephemeral server session, reports successful layer reloads, and cleans up on process signals
