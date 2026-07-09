# GitHub Issues Plugin

First-party Cradle server plugin that registers an external issue source named `github-issues`.

The plugin reads GitHub Issues through the GitHub REST API and returns a fixed snapshot to the Cradle host. It does not write Cradle databases directly, does not create normal Cradle issues, and does not render Settings or Kanban UI. Cradle's `external-issue-sources` module owns workspace repository bindings, shared repository cursors, read-only external issue items, and local Kanban status overlays.

## Configuration

- `CRADLE_GITHUB_ISSUES_TOKEN`: optional plugin-specific GitHub token. When absent, the Cradle host provides the same GitHub token resolved by the common server GitHub client from `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth token`. Private repositories require one of these token paths.
- `CRADLE_GITHUB_API_BASE_URL`: optional GitHub or GitHub Enterprise REST base URL. Defaults to `https://api.github.com`.
- `CRADLE_GITHUB_ISSUES_MAX_PER_REPO`: optional maximum issues per repository per refresh. Defaults to `100`.

Repository selection is not configured here. Users bind `owner/repo` to a Cradle workspace through Settings or the generated `external-issue-source bind` CLI command. Refreshes operate on those Cradle-owned bindings.

## Setup

1. Ensure the plugin is built and loaded by the server.
2. Open Settings > GitHub Issues.
3. Select a workspace and enter a repository as `owner/repo`.
4. Keep `Refresh after binding` enabled for the first manual sync, or refresh later from the binding row.

The same flow is available from the generated CLI:

    cradle external-issue-source list
    cradle external-issue-source bind <sourceKey> --workspace <name-or-id> --repository-owner owner --repository-name repo --refresh-now
    cradle external-issue-source refresh --binding-id <bindingId>

GitHub labels, assignees, milestone, state, number, URL, and timestamps stay source-owned. Cradle stores only the binding, sync metadata, durable external item projection, and local Kanban status.
