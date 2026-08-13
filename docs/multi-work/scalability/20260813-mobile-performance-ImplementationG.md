# Mobile collection and summary-event performance handoff

## Scope

This slice implements and reviews scalability finding 8 in `apps/mobile` only:

- Virtualize the Workspaces, Workspace detail, and Work collection surfaces with `FlatList` or `SectionList`.
- Let `Screen` host a non-scrolling, flex-filling collection child.
- Replace the active-summary 5-second query polling in those three containers with the durable global Session event tail.

## Implementation

- `ProjectsView` renders workspaces with `FlatList`.
- `WorkspaceView` projects Work, Conversation, and bounded top-level File rows into one keyed `FlatList`.
- `WorkListView` renders time groups with a non-sticky `SectionList`.
- `Screen` gives its static-content path the remaining page height so native virtualized lists own scrolling and pull-to-refresh.
- `ProjectsContainer`, `WorkspaceContainer`, and `WorkListContainer` subscribe only while their route and the app are active. Events are coalesced before the bounded summary query is refreshed.
- The event-tail consumer keeps a durable increasing sequence cursor across reconnects, tolerates fragmented CRLF frames, ignores malformed/unrelated/duplicate frames, and reconnects without refreshing on connection failure. The last behavior is important: refreshing on every failed reconnect would recreate the removed 5-second poll during an outage.

The existing mobile chat-stream test now reads its WHATWG stream through a reader instead of relying on an optional async-iterator type, allowing the package TypeScript check to complete under the repository's current TypeScript/lib configuration.

## Focused coverage

`apps/mobile/src/lib/use-session-summary-events.test.ts` feeds the event consumer deliberately fragmented SSE input and proves that malformed JSON, another scope, the starting cursor, and a duplicate sequence do not dispatch refresh events. A later valid sequence dispatches exactly once.

## Validation

Run from the repository root:

    node_modules/.bin/vitest run apps/mobile/src/lib/use-session-summary-events.test.ts apps/mobile/src/features/chat/chat-stream.test.ts
    node_modules/.bin/tsc --noEmit -p apps/mobile/tsconfig.json
    pnpm --filter @cradle/mobile lint
    git diff --check -- apps/mobile docs/multi-work/scalability/20260813-mobile-performance-ImplementationG.md

Results on 2026-08-13:

- Vitest: 2 files, 3 tests passed.
- Mobile TypeScript: passed with no diagnostics.
- Mobile ESLint: passed.
- Diff whitespace check: passed.

## Notes

The collection queries intentionally remain first-page, bounded summary reads (`limit=200`), matching the API migration performed by the Work/Session scalability slice. The event tail changes freshness for active summary surfaces without introducing a second cache owner or a periodic success-path request.
