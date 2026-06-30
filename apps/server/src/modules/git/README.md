# Git Module

Provides workspace-owned HTTP access to Git repository discovery, status, working-tree file changes, branches, remotes, merge-base lookup, commit graph, checkout, branch creation, and fetch.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: workspace-owned Elysia endpoints under `/workspaces/:id/git/*`, including CLI metadata for agent-facing operations.
- `model.ts`: TypeBox request and response schemas for the git HTTP surface, including repository summaries, status file-change entries, repo-scoped query/body fields, and merge-base lookup.
- `service.ts`: workspace resolution, repository discovery, repository-scoped simple-git orchestration, status file-change normalization, and merge-base resolution.

## Routes

- `GET /workspaces/:id/git/repositories`: discover Git repositories inside a workspace and return per-repository branch and file-change summaries. Exposed to CLI as `workspace git repositories`.
- `GET /workspaces/:id/git/status`: current branch, tracking status, and normalized working-tree file changes for one repository. Accepts optional `repo` query; it is required when a workspace has multiple repositories. Exposed to CLI as `workspace git status`.
- `GET /workspaces/:id/git/branches`: local and remote branch names for one repository. Accepts optional `repo` query. Exposed to CLI as `workspace git branches`.
- `GET /workspaces/:id/git/remotes`: configured remote names and fetch/push URLs for one repository. Accepts optional `repo` query.
- `GET /workspaces/:id/git/graph`: commit graph data for rendering one repository. Accepts optional `repo` query. Exposed to CLI as `workspace git graph`.
- `GET /workspaces/:id/git/merge-base`: resolve `git merge-base HEAD <baseBranch>` for one repository. Accepts optional `repo` query.
- `POST /workspaces/:id/git/checkout`: checkout a local or remote branch for one repository. Accepts optional `repo` body field. Exposed to CLI as `workspace git checkout`.
- `POST /workspaces/:id/git/branches`: create a branch for one repository. Accepts optional `repo` body field. Exposed to CLI as `workspace git branch create`.
- `POST /workspaces/:id/git/fetch`: fetch all remotes with prune for one repository. Accepts optional `repo` body field. Exposed to CLI as `workspace git fetch`.

Repository identity is `workspaceId` plus a workspace-relative repository path. The workspace-root repository uses `.`. File status entries expose repo-relative `path` for Git operations and workspace-relative `workspacePath` for workspace file UI actions.
