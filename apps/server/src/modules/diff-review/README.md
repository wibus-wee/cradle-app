<!-- Once this directory changes, update this README.md -->

# Diff Review Module

The diff-review module owns Cradle Diffs review records, local worktree, branch-compare, commit, and GitHub pull request revisions, review threads, guide generation, agent fix work orders, commit plans, and source readiness projections.

## Files

- **index.ts**: Elysia routes for workspace diff reviews and CLI-exposed diff commands.
- **model.ts**: TypeBox schemas for review, revision, file, thread, guide, agent fix, commit plan, and readiness contracts.
- **service.ts**: Business logic for source adapters, refreshing local and GitHub review sources, comments, submissions, change walkthrough generation, agent fixes, commit plans, and event recording.
- **anchors.ts**: Diff range anchor normalization and revision remapping helpers.
- **patch.ts**: Patch parsing, file summary extraction, generated-file detection, and line hashing.
- **commit-plans.ts**: Commit plan normalization and commit-application helpers.
- **agent-fix-artifacts.ts**: Agent fix artifact projection from completed chat runs.
- **types.ts**: Module view and input types.
- **utils.ts**: JSON, hashing, and title helpers.

## Change Walkthrough

`POST /workspaces/:id/diff-reviews/:reviewId/guide/generate` is owned by this module. For local working tree reviews it performs synchronous provider preflight checks, records a `running` guide row, starts an ephemeral tool-enabled Chat Runtime turn, enqueues a durable `guide-generation` Background Job, and returns the review immediately. The route accepts an explicit `runtimeKind`; when omitted, Diff Review selects the first registered chat runtime from the runtime catalog that is provider-backed and compatible with the provider target kind. It also accepts `outputLocale` so user-facing generated prose follows the UI language while paths, ids, and repository text stay unchanged. The generic Background Job module polls durable `backend_runs` state; the Diff Review-owned projector parses and writes the guide artifact after completion. `POST /workspaces/:id/diff-reviews/:reviewId/guide/cancel` cancels the durable job, whose Chat Runtime source adapter aborts the backing session before Diff Review records the user cancellation. Late artifacts cannot overwrite a cancelled or replaced guide row.

The provider outputs a change walkthrough with path and line-range candidates only. It explains how the change is constructed rather than scoring risk or issuing a review verdict. Diff Review derives stable step ids, order, file ids, and `ReviewRangeAnchorView` anchors from the stored review revision.

GitHub pull request sources are materialized through the Pull Request module's live detail reader. Refreshes update the immutable diff revision and remote open/merged/closed state. Review decisions are submitted to GitHub before being marked `synced`; failed remote submissions remain recorded with `sourceSyncState: "failed"` and are returned as operation errors to the caller.

Commit plan generation is started through the agent-fix start/rerun routes with `expectedOutput: "commit"`. These runs enqueue durable `commit-plan-generation` Background Jobs instead of retaining an in-process Chat Runtime waiter. The Diff Review-owned projector validates that the target revision is still current, parses the terminal assistant artifact, inserts one idempotent commit plan linked to the agent fix, and updates the work order. Other agent-fix output modes keep their existing completion path. The routes accept `outputLocale` for plan titles and rationale; commit message subjects still follow the repository's existing commit style rather than UI localization.
