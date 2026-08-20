# Work and Session performance implementation handoff

## Scope

This slice implements scalability findings 2, 4, 14, and 19 for Work/Session collection reads and unchanged Background Job observations. It intentionally does not push or open a pull request.

## Delivered behavior

- `GET /sessions` and `GET /works` now return `{ items, nextCursor }`. Both default to 100 rows and reject HTTP limits above 200; service callers are also clamped to 200.
- Cursors are opaque base64url values over the stable descending sort tuple. Session ordering remains latest user message time, falling back to Session creation time. Work ordering remains update time, creation time, then id.
- Session pages batch requested-model bindings, latest run status, message activity, Worktree rows, and remote execution links. Work pages join their primary Session in the page query and reuse the bounded Session projection.
- Work list responses decode the Pull Request owner's cached Session projection and make no GitHub call. Session list responses do not start remote title synchronization. Point/detail paths retain their explicit refresh behavior.
- The web workspace sidebar now owns one global Work summary map. Per-workspace bodies derive their slice from that map instead of issuing one Work query per rendered workspace.
- Background Job source observations are normalized by recursively sorting JSON object keys. Semantically unchanged observations and repeated identical source-poll errors preserve `updatedAt` and skip the SQLite update.
- Web/mobile generated API types, web TanStack query helpers, generated CLI list commands, and all direct web/mobile consumers were migrated to the page contract. Summary-only consumers intentionally request one bounded page.

## Main implementation files

Server contract and projections:

- `apps/server/src/modules/session/{index.ts,model.ts,service.ts,remote-projection.ts}`
- `apps/server/src/modules/work/{index.ts,model.ts,service.ts}`
- `apps/server/src/modules/worktree/service.ts`
- `apps/server/src/modules/session-await/service.ts`
- `apps/server/src/modules/chat-runtime/pending-tool-approval.ts`
- `apps/server/src/modules/pull-request/service.ts`
- `apps/server/src/modules/background-job/service.ts`

Consumers and generated contract:

- `apps/web/src/api-gen/{types.gen.ts,zod.gen.ts,@tanstack/react-query.gen.ts}`
- `apps/mobile/src/api-gen/types.gen.ts`
- `packages/cli/src/commands/generated/{session/list.ts,work/list.ts}`
- `apps/web/src/features/workspace/use-session.ts`
- `apps/web/src/features/work/use-work.ts`
- `apps/web/src/features/workspace/workspace-sidebar.tsx`
- `apps/mobile/src/features/{projects,work,chat}` page consumers

Documentation was updated in the Session, Work, and Background Job module READMEs, `apps/server/specs/capabilities/session.md`, and the campaign ExecPlan.

## Tests and validation

Passed:

    cd apps/server
    ../../node_modules/.bin/vitest run \
      src/modules/session/service.test.ts \
      src/modules/work/service.test.ts \
      tests/background-job.test.ts
    # 3 files, 34 tests passed

    cd ../..
    node_modules/.bin/vitest run apps/web/src/features/workspace/use-session.test.ts
    # 1 file, 4 tests passed

    node_modules/.bin/tsc --noEmit -p apps/server/tsconfig.json
    node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
    node_modules/.bin/tsc --noEmit -p packages/cli/tsconfig.json
    # passed

    node_modules/.bin/eslint <owned server/web/mobile TypeScript files>
    git diff --check
    # passed

The page tests seed 205 records and traverse three cursor pages without duplicates or omissions. The Work test also asserts that `PullRequest.getPullRequest` is not called by list. The Background Job test changes `Date.now()` between equal normalized observations and proves `updatedAt` does not move.

## Shared-worktree caveats

The repository is shared with other scalability implementations. A rerun of `apps/server/tests/session.test.ts` was blocked before its route assertions by concurrent Chronicle composition code calling `startMemoryEmbeddingIndexer` before that export existed. The earlier run reached the changed Session assertions and identified the expected array-to-page test updates, which are included here. Mobile `tsc` reaches an unrelated `ReadableStream<UIMessageChunk>` async-iterator diagnostic in `apps/mobile/src/features/chat/chat-stream.test.ts`; the changed mobile page consumers are clean.

Generated files were produced while other agents also had uncommitted contract changes. This implementation's commit stages only the Work/Session hunks in mixed generated files and leaves other agents' generated changes unstaged.

## Follow-up considerations

Work list PR state is now deliberately cached. Existing explicit Work/PR detail reads update the stored projection; a future owner may add a TTL or event-driven reconciler if merge state must refresh while no detail surface is opened. UI summary consumers currently request the maximum bounded first page (200); they do not silently walk the complete history.
