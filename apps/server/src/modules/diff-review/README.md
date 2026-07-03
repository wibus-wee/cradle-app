<!-- Once this directory changes, update this README.md -->

# Diff Review Module

The diff-review module owns Cradle Diffs review records, local worktree, branch-compare, and commit revisions, review threads, guide generation, agent fix work orders, commit plans, and source readiness projections.

## Files

- **index.ts**: Elysia routes for workspace diff reviews and CLI-exposed diff commands.
- **model.ts**: TypeBox schemas for review, revision, file, thread, guide, agent fix, commit plan, and readiness contracts.
- **service.ts**: Business logic for source adapters, refreshing review sources, comments, submissions, change walkthrough generation, agent fixes, commit plans, and event recording.
- **anchors.ts**: Diff range anchor normalization and revision remapping helpers.
- **patch.ts**: Patch parsing, file summary extraction, generated-file detection, and line hashing.
- **commit-plans.ts**: Commit plan normalization and commit-application helpers.
- **agent-fix-artifacts.ts**: Agent fix artifact projection from completed chat runs.
- **types.ts**: Module view and input types.
- **utils.ts**: JSON, hashing, and title helpers.

## Change Walkthrough

`POST /workspaces/:id/diff-reviews/:reviewId/guide/generate` is owned by this module. For local working tree reviews it performs synchronous source and provider preflight checks, records a `running` guide row, returns the review immediately, then starts an ephemeral tool-enabled runtime turn in the background. The route accepts an explicit `runtimeKind`; when omitted, Diff Review selects the first registered chat runtime from the runtime catalog that is provider-backed and compatible with the provider target kind. The provider inspects the live repository with shell/file tools, and Diff Review later marks the guide `ready` or `failed`. `POST /workspaces/:id/diff-reviews/:reviewId/guide/cancel` is also owned here: it asks Chat Runtime to abort the backing session, marks the guide `cancelled`, and ignores late artifacts from the stopped run.

The provider outputs a change walkthrough with path and line-range candidates only. It explains how the change is constructed rather than scoring risk or issuing a review verdict. Diff Review derives stable step ids, order, file ids, and `ReviewRangeAnchorView` anchors, and rejects stale worktree state by comparing the current `Git.getDiff()` hash with the revision `patchHash` before and after generation.
