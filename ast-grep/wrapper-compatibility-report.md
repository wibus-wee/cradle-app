# Wrapper And Bad-Smell Scan

## Default Cleanup Scan

Command:

```sh
ast-grep scan apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Current default cleanup baseline:

| Rule | Matches |
|---|---:|
| all default cleanup rules | 0 |

Current default findings:

- None. The default cleanup scan is clean with generated/build artifacts excluded.

## Optional Facade Audit

Run this when reviewing ownership boundaries and SDK pass-through surfaces. These matches are kept out of `sgconfig.yml` only because they are broader and noisier than the default structural cleanup queue:

```sh
ast-grep scan -c ast-grep/audit-sgconfig.yml apps packages plugins \
  --globs '!apps/web/src/api-gen/**' \
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**' \
  --globs '!**/node_modules/**' \
  --globs '!**/dist/**' \
  --globs '!apps/desktop/release/**' \
  --report-style short
```

Current optional audit baseline:

| Rule | Matches |
|---|---:|
| generated-query-wrapper | 20 |
| service-pass-through-wrapper | 5 |

Current audit classification:

- Route/tab lazy loader and preload-only wrappers were removed from the audit baseline. Route chunk imports now live in the owning `.tab.tsx` files, and startup route preload calls the tab-owned `preload` hooks instead of feature-local loader files.
- Single-use TSX-local query hooks were collapsed back into their owning components. Remaining feature query hooks are exported owner boundaries that add query keys, enabled guards, polling/stale-time policy, select transforms, schema parsing, mutation invalidation, or cache update semantics.
- Server pass-through hits are broad audit candidates. Confirmed cleanup removed Search's Chronicle search service relay, Chronicle's daemon resources service relay, dead validation/error plugin exports, unused Search service exports, and single-call DB/filter helpers. Remaining matches are HTTP plugin factory helpers, test setup helpers, search engine orchestration, or UI projection helpers.
- `GET /chronicle/resources` was a real ambiguous duplicate of `GET /chronicle/daemon/resources`; it was removed, and web/CLI/OpenAPI projections now use the daemon namespace.

Remaining audit findings are currently classified as intentional noise:

| File | Match | Why it remains owned |
|---|---|---|
| `apps/server/src/http/request-id.ts` | `createRequestIdPlugin` | HTTP infrastructure owns the request-id header contract, generated fallback id, Elysia global derive shape, and response header propagation. The broad pass-through rule matches the plugin factory chain, not a compatibility facade. |
| `apps/server/src/http/request-logger.ts` | `createRequestLoggerPlugin` | HTTP infrastructure owns request-scoped logger derivation, duration measurement, slow-request thresholding, and observability event recording. Keeping it as an Elysia plugin factory is the owned integration surface. |
| `apps/server/src/modules/search/service.ts` | `searchThreads` | Search service owns the singleton `ThreadSearchEngine` lifecycle and session cleanup subscription. The route and tests must not construct their own engine because that would split the index owner. |
| `apps/server/tests/automation.test.ts` | `createAutomationWithInputs` | Test helper owns the repeated POST request fixture used by multiple file-input validation cases; inlining it would duplicate request construction without removing product code debt. |
| `apps/web/src/features/workspace/use-session.ts` | `asSessionLayoutRecords` | Workspace session feature owns the projection from normalized `WorkspaceSession` rows into `useSessionLayoutStore` records. The function is a projection boundary used by both active and archived session effects. |
| `apps/web/src/features/git/use-git.ts` | `useGitStatus`, `useGitFileStatuses`, `useGitBranches`, `useGitRemotes`, `useGitGraph` | Git feature owns generated endpoint projection into UI query policy: active/background refresh, enabled guards, retries, `files` select, `keepPreviousData`, and exported query-key builders used for external invalidation. |
| `apps/web/src/features/chat/use-runtime-session-status.ts` | `useRuntimeSessionStatus` | Chat runtime UI owns the non-generated command query key and polling policy. Refetching is tied to streaming, pending, cancelling, and active-goal status, which is UI runtime behavior rather than SDK ownership. |
| `apps/web/src/features/chat/use-session-await.ts` | `useSessionAwaitSummary` | Chat/right-aside surfaces share the session-await summary with an enabled guard and interactive refresh policy. The hook is the chat feature contract for await badges and panes. |
| `apps/web/src/features/settings/use-chat-preferences.ts` | `useChatPreferencesQuery` | Settings owns the chat preferences schema parse, canonical query key, mutation cache update, and simplified `useChatPreferences` facade consumed by settings and composer runtime. |
| `apps/web/src/features/automation/use-automations.ts` | `useAutomationDefinitions` | Automation feature owns the definitions cache key, list API client, stale time, retry policy, and mutation invalidation contract reused by dashboard and home. |
| `apps/web/src/features/workspace/use-workspace-file-content.ts` | `useWorkspaceFileInfo`, `useWorkspaceFileContent` | Workspace file feature owns file info/content query keys, enabled guards, raw/PDF URL builders, write mutation payload shape, git status invalidation, and cache updates after writes. |
| `apps/web/src/features/skills/use-skills.ts` | `useSkillDocument` | Skills feature owns scope/name/context projection to IPC query params and parses the nullable response with `SkillDocumentSchema` before exposing it to manager panes. |
| `apps/web/src/features/kanban/use-kanban.ts` | `useBoards`, `useStatuses`, `useMilestones`, `useIssues`, `useIssue`, `useComments`, `useRelations`, `useLinkedIssue` | Kanban feature owns schemas, query-key namespace, refresh policy, enabled guards, request parameter normalization, and mutation invalidation around the issue board domain. These are not generated SDK aliases. |

## Language-Agnostic Ownership Header Scan

Command:

```sh
ast-grep/scripts/scan-ownership-headers.sh
```

Current top-header scan baseline:

| Metric | Count |
|---|---:|
| Matched lines | 0 |
| Files with matches | 0 |

The scan reports only file-leading ownership triplets. It intentionally ignores body prose, docs, report snippets, and test fixtures that mention `Output:`, `Input:`, or `Position:` outside the first header block.
