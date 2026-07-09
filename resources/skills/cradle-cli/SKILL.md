---
name: cradle-cli
description: Interact with Cradle via the generated CLI. Use for Cradle-owned workflows such as issues, delegation, session pause/resume awaits, CI/review waits, timed waits, workspace/git inspection, Chronicle memory/activity, automations, usage, observability, skills, agents, profiles, and server state instead of calling the HTTP API or defaulting to ad hoc bash/gh polling.
---

# Cradle CLI

Use `cradle` to manage Cradle or query its state from the terminal. You can use it for quick queries, scripted interactions, or as a reference for how the HTTP API maps to user-friendly commands.

## Core Rules

- Prefer `cradle` for Cradle-owned product semantics. Use ordinary shell tools for local file/process work, but do not replace Cradle session awaits, issue state, delegation, Chronicle, automation, workspace, usage, or observability workflows with ad hoc scripts.
- For waiting on external or future events, register a Cradle session await and end your turn. Do not use `sleep`, long polling loops, `gh run watch`, or repeated manual checks when Cradle has an await source for the condition.
- Use `gh` only for GitHub actions that Cradle does not expose. If the goal is to pause this session until CI or PR review changes, use `cradle session await ...`.
- `cradle man` prints the full generated command manual. Use `cradle man <module>` or `cradle man <command...>` to narrow it.
- This skill is not the full route list. It gives operating patterns and an auto-generated module index; exact commands come from `cradle man`.
- Default output is human-readable. Use `--json <fields>` for Agent workflows and `--format json` for compact pipeline output.
- Most relationships use IDs, but issue statuses are Agent-facing names/slugs. Use status names like `triage`, `to_do`, or `in_progress` instead of status IDs when creating or moving issues.
- Use `--server <url>` only when the default `CRADLE_SERVER_URL` / `http://localhost:21423` is not the intended server.

## Use Cradle First For

| Goal | Start Here | Avoid As Primary Path |
| --- | --- | --- |
| Wait for CI, review, approval, or later continuation | `cradle session await ...` | `sleep`, polling loops, `gh run watch` |
| Manage tasks, status, comments, delegation, or issue sessions | `cradle issue ...`, `cradle issue-agent-session ...` | local TODO files, direct DB edits |
| Inspect workspace identity, files, or git state | `cradle workspace ...` | guessing workspace IDs, raw HTTP |
| Search Cradle state or past threads | `cradle search ...` | grepping data directories |
| Read or maintain Chronicle memory/activity/knowledge | `cradle chronicle ...` | direct SQLite edits |
| Schedule or inspect recurring work | `cradle automation ...` | cron scripts outside Cradle |
| Inspect cost, tokens, incidents, traces, or runtime diagnostics | `cradle usage ...`, `cradle observability ...`, `cradle chat ...` | manual log spelunking first |
| Manage agents, profiles, skills, ACP, providers, preferences | `cradle agent ...`, `cradle profile ...`, `cradle skill ...`, `cradle acp ...` | editing registry files by hand |

## Environment Variables

Cradle automatically injects these environment variables into your shell — no manual setup needed:

| Variable | Description |
| --- | --- |
| `CRADLE_CHAT_SESSION_ID` | Your current chat session ID |
| `CRADLE_WORKSPACE_ID` | The workspace ID for this session |

Use them directly in commands (e.g. `$CRADLE_CHAT_SESSION_ID`). They are available in both GUI (Claude Agent) and TUI (terminal) modes.

### Workspace resolution

Commands that need a workspace expose a `--workspace <name-or-id>` flag (or a `[workspace]`/`<workspace>` positional argument), resolved in this order — no raw UUID required:

1. The value you pass explicitly (`--workspace my-app` or `cradle workspace get my-app`) — accepts a workspace **name** (case-insensitive, unambiguous prefix also works) or its id.
2. `CRADLE_WORKSPACE_ID`, when set (this is how Cradle-managed agent shells scope commands automatically).
3. The workspace whose registered path is an ancestor of your current directory — run `cradle` from inside an imported workspace and it just works, no flag or env var needed.

Destructive/administrative commands (`workspace delete`, `workspace update`, `workspace migrate`, `workflow-rule delete`, ...) still accept a name or id but never fall back through env/cwd — you must always name the target explicitly, so a stale ambient workspace can't be silently affected.

Optional workspace-scoped list/search commands (e.g. `issue list`) resolve ambiently by default; pass `--all-workspaces` when you intentionally want a global query instead.

## Discovery

```bash
cradle --help
cradle man
cradle man session await
cradle man issue
cradle man issue create
cradle man workspace git status
cradle man chronicle memories search
cradle man automation create
cradle workspace list --json id,name,path
cradle issue status list --json id,name
cradle profile list --json id,name,providerKind,enabled
cradle agent list --json id,name,agentProfileId,enabled
```

## Issue Workflow

```bash
cradle issue list --json id,title,statusId,priority,assigneeKind,assigneeId
cradle issue create --title "Fix login redirect" --description "Describe the failure mode"
cradle issue create --workspace my-app --title "Triage build failure" --status-name triage
cradle issue move <issueId> in_progress
cradle issue update <issueId> --priority high --labels bug,agent
cradle issue get <issueId> --json id,title,description,statusId,priority
```

Omit `--status-name` to let the server attach the default workspace status. Use `cradle issue status list` only when you need to inspect available status names; status names are matched as lower-case slugs with spaces converted to underscores.

## Comments And Delegation

```bash
cradle issue comment list <issueId> --json id,content,createdAt
cradle issue comment add <issueId> --content "Analysis complete."
cradle issue delegate <issueId> --agent-profile-id <agentProfileId>
cradle issue delegation <issueId> --json issueId,delegated,agentProfileId,agentSessionId,chatSessionId
cradle issue undelegate <issueId>
```

## Workspace Helpers

```bash
cradle workspace list --json id,name,path
cradle workspace get                                   # ambient: resolved from $PWD or CRADLE_WORKSPACE_ID
cradle workspace files --json type,name,path            # same — workspace argument is optional
cradle workspace file read --path AGENTS.md
cradle workspace git status --json branch,tracking,ahead,behind,isDetached
cradle workspace git diff my-app --paths src/index.ts --format json  # explicit name, another workspace
```

## Output Patterns

```bash
cradle issue list
cradle issue list --all-workspaces
cradle issue list --workspace my-app --json id,title,statusId
cradle issue list --format json
cradle issue list --format ndjson
```

Use default output for human inspection, `--json <fields>` for structured Agent reads, and `--format ndjson` when streaming rows into shell pipelines.

## Chat Stream Trace

In development, chat runtime writes provider-to-SSE trace files under `CRADLE_DATA_DIR/chat-runtime/traces`. Use these commands to decide whether a streaming issue came from the provider, SDK mapper, projection, SSE emit, store, or UI layer.

```bash
cradle chat trace session "$CRADLE_CHAT_SESSION_ID" --format json
cradle chat trace session "$CRADLE_CHAT_SESSION_ID" --json traces
cradle chat trace run <runId> --format json
cradle chat trace run <runId> --json records
```

Inspect phases in order: `provider_raw`, `mapper_output`, `runtime_chunk`, `projection_apply`, `sse_emit`.

## Session Await (Pause & Resume)

Register an await to pause your session and let Cradle automatically resume it when an external condition is met:

```bash
# Register a CI wait on a PR — Cradle will resume this session when CI passes
cradle session await github-ci owner/repo \
  --pr 42 \
  --reason "Waiting for CI on PR #42"

# Register a CI wait on a specific commit (no PR needed)
cradle session await github-ci owner/repo \
  --sha abc123def \
  --reason "Waiting for CI on commit abc123def"

# Register a CI wait on one GitHub check run
cradle session await github-ci owner/repo \
  --run-id 1234567890 \
  --reason "Waiting for GitHub check run 1234567890"

# Register a PR review wait
cradle session await github-review owner/repo \
  --pr 42 \
  --mode approved \
  --reason "Waiting for PR #42 approval"

# Register a manual trigger-only wait
cradle session await manual \
  --reason "Waiting for deploy approval"

# Register a timed wait with the raw generated command
fire_at=$(($(date +%s) + 1800))
cradle session await-create \
  --chat-session-id "$CRADLE_CHAT_SESSION_ID" \
  --source timer \
  --filter-json '{}' \
  --fire-at "$fire_at" \
  --reason "Waiting 30 minutes before checking again"

# Check await status
cradle session await-summary --session-id "$CRADLE_CHAT_SESSION_ID"

# List all awaits for current session
cradle session await-list --session-id "$CRADLE_CHAT_SESSION_ID"

# Cancel an await
cradle session await-cancel <awaitId>

# Manually trigger (for testing)
cradle session await-trigger <awaitId> --resume-text "CI passed"

# Retry delivery after a matched await failed to enqueue its resume message
cradle session await retry <awaitId>
```

**Key rules for await usage**:
- `$CRADLE_CHAT_SESSION_ID` and `$CRADLE_WORKSPACE_ID` are automatically injected as environment variables by Cradle — they are always available in your shell without any setup.
- After registering an await, end your turn. Cradle will resume the session with the trigger payload as a new user message.
- Prefer the task-shaped `cradle session await ...` commands. The raw generated `cradle session await-create` command is still available when you need to pass a custom source/filter payload directly.
- Supported task-shaped sources: `github-ci` (`--pr`, `--sha`, or `--run-id`), `github-review` (`--mode approved|changes-requested|reviewed`), and `manual`.
- Supported raw await sources include `github-ci`, `github-review`, `manual`, and `timer`. Use raw `await-create --source timer --fire-at <unixSeconds> --filter-json '{}'` for durable timed pauses.
- Your session history is preserved — when resumed, you have full context of what you were doing.

## Chronicle And Memory

Chronicle is the Cradle-owned namespace for activity capture, memory, knowledge cards, privacy export, local model resources, transcripts, and activity pipeline operations. Use `cradle man chronicle` before assuming a direct data-store path.

```bash
cradle chronicle status --format json
cradle chronicle timeline --limit 20 --format json
cradle chronicle memories search --q "release decision" --limit 10 --format json
cradle chronicle knowledge-cards list --limit 20 --format json
cradle chronicle activity-segments list --limit 10 --format json
cradle chronicle activity-pipeline tick --format json
cradle chronicle privacy redact --text "Sensitive text to preview"
```

## Automation, Usage, And Diagnostics

```bash
cradle automation list --format json
cradle automation run <automationId> --format json
cradle automation runs <automationId> --format json
cradle usage summary --format json
cradle usage cost summary --from 2026-01-01 --to 2026-01-31 --format json
cradle observability incidents --status open --limit 20 --json id,code,status,lastSeenAt
cradle observability events --chat-session-id "$CRADLE_CHAT_SESSION_ID" --limit 50 --format json
```

<!-- CRADLE_CLI_MODULES_START -->
## Command Modules

It intentionally lists modules, not routes or leaf actions. Use `cradle man <module>` for full command manuals.

| Module | Commands | Scope | Manual |
| --- | ---: | --- | --- |
| `acp` | 9 | Manage ACP agent installation and registry state. | `cradle man acp` |
| `agent` | 5 | Manage Cradle agent identities. | `cradle man agent` |
| `automation` | 13 | Manage scheduled automations, runs, and artifacts. | `cradle man automation` |
| `board` | 4 | Manage Kanban boards. | `cradle man board` |
| `chat` | 14 | Control chat runtime commands. | `cradle man chat` |
| `chronicle` | 56 | Generated Cradle CLI module. | `cradle man chronicle` |
| `external-issue-source` | 9 | Generated Cradle CLI module. | `cradle man external-issue-source` |
| `health` | 1 | Check server health. | `cradle man health` |
| `issue` | 30 | Manage Kanban issues, comments, relations, delegation, and context refs. | `cradle man issue` |
| `issue-agent-session` | 3 | Inspect and control issue agent sessions. | `cradle man issue-agent-session` |
| `link-preview` | 1 | Generated Cradle CLI module. | `cradle man link-preview` |
| `observability` | 5 | Inspect local observability events, incidents, and exports. | `cradle man observability` |
| `opencode` | 1 | Generated Cradle CLI module. | `cradle man opencode` |
| `plugin` | 7 | Generated Cradle CLI module. | `cradle man plugin` |
| `preferences` | 10 | Read and update server preferences. | `cradle man preferences` |
| `profile` | 5 | Manage agent profiles. | `cradle man profile` |
| `provider` | 1 | Inspect provider model availability. | `cradle man provider` |
| `relay-server` | 4 | Generated Cradle CLI module. | `cradle man relay-server` |
| `relay-transport` | 5 | Generated Cradle CLI module. | `cradle man relay-transport` |
| `remote-host` | 8 | Generated Cradle CLI module. | `cradle man remote-host` |
| `search` | 2 | Search Cradle data. | `cradle man search` |
| `secret` | 2 | Manage secret metadata. | `cradle man secret` |
| `session` | 22 | Manage chat sessions and session links. | `cradle man session` |
| `session-group` | 7 | Generated Cradle CLI module. | `cradle man session-group` |
| `skill` | 10 | Manage skills and skill sources. | `cradle man skill` |
| `usage` | 10 | Inspect usage and cost data. | `cradle man usage` |
| `workflow-rule` | 4 | Manage workflow rules. | `cradle man workflow-rule` |
| `workspace` | 53 | Manage workspaces, files, and git helpers. | `cradle man workspace` |

<!-- CRADLE_CLI_MODULES_END -->

