<!-- Once this directory changes, update this README.md -->

# Diff Review Module

The diff-review module owns Cradle Diffs review records, local worktree, branch-compare, commit, and GitHub pull request revisions, review threads, agent fix work orders, and source readiness projections.

GitHub Auth owns connection credentials and identity selection. This module uses
the shared GitHub API client for remote review operations and never manages
tokens itself. Repository operations therefore use the connected App identity
only when its installation includes the repository, with the local `gh`
credential as the repository-level fallback.

## Files

- **index.ts**: Elysia routes for workspace diff reviews and CLI-exposed diff commands.
- **model.ts**: TypeBox schemas for review, revision, file, thread, agent fix, and readiness contracts.
- **service.ts**: Business logic for source adapters, refreshing local and GitHub review sources, comments, submissions, agent fixes, and event recording.
- **anchors.ts**: Diff range anchor normalization and revision remapping helpers.
- **patch.ts**: Patch parsing, file summary extraction, generated-file detection, and line hashing.
- **agent-fix-artifacts.ts**: Agent fix artifact projection from completed chat runs.
- **types.ts**: Module view and input types.
- **utils.ts**: JSON, hashing, and title helpers.

## Agent Fix

Agent fix work orders are created via `POST /workspaces/:id/diff-reviews/:reviewId/agent-fixes` and support `expectedOutput: "working-tree-change" | "patch-artifact"`. Starting a work order creates a Chat Runtime session with `origin: "cradle-review"`, and `watchAgentFixRunCompletion` waits for the run to finish before projecting the result (artifact, resulting revision) back onto the work order and recording the completion event.

GitHub pull request sources are materialized through the Pull Request module's live detail reader. Refreshes update the immutable diff revision, PR metadata, checks, activity, remote open/merged/closed state, and GraphQL review threads. Remote thread and comment node ids map deterministically onto the existing thread tables, so repeated refreshes reconcile replies and resolution without duplicate local records. New inline threads, replies, and resolution are written to GitHub before the local projection changes. Review decisions follow the same rule before being marked `synced`; failed remote submissions remain recorded with `sourceSyncState: "failed"` and are returned as operation errors to the caller. The merge route validates draft, open, mergeability, and check state before calling GitHub, which remains the final permission and branch-protection authority.
