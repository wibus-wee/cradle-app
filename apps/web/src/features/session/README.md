<!-- Once this directory changes, update this README.md -->

# features/session

Session domain owner. React Query is the only Session business-projection
authority — there is no Session Zustand store. All Session cache topology
(generated query keys, list/detail/runtime/queue projection families,
optimistic writes, rollback, recovery) is owned by
`api/session-projection.ts`. External adapters — the global event tail,
desktop tray, chat runtime, pages — submit semantic facts to the gateway and
must not compose Session query keys or mutate Session cache topology
directly.

Recovery semantics: `SnapshotRequired` events preserve their `sessionId` and
trigger targeted recovery (lists + detail + runtime + queue for that session);
identity-less transport failures trigger one coalesced global refresh wave
across every existing Session projection query. Recovery coalescing is
explicit promise ownership, not timing-based debounce: concurrent callers join
the in-flight wave, and arrivals during a wave queue exactly one follow-up.

Issue–execution association mutations reconcile Session projections through
this gateway: `features/kanban/use-issue-execution-association` consumes the
server's typed previous/next transition and calls `refreshSessionProjections`
for Session participants, so link/unlink/relink never composes Session query
keys outside this directory.

## Files

- **api/session-projection.ts**: Session projection gateway — the sole owner of Session cache topology. Exposes query-key constructors and options (`sessionsQueryKey`, `sessionListOptions`, `sessionDetailQueryKey`, `sessionDetailOptions`, `sessionQueueQueryKey`), projection-family predicates (`isSessionsQueryKey`, `isSessionProjectionQueryKey`), optimistic writes (`projectCreatedSession`, `projectSessionActivity`, `applySessionOptimisticPatch`, `applySessionReadResult`, `applyConfirmedSession`, `rollbackSessionOptimisticPatch`, `updateUnreadSessionIdsSnapshot`), semantic refresh (`refreshSessionLists`, `refreshSessionProjections`, `refreshSessionDetail`, `refreshSessionRuntimeStatus`, `refreshSessionQueue`, `dropSessionProjection`), event projection (`applySessionTailEvent`), and coalesced gap recovery (`recoverProjectionGap`).
- **api/session-projection.test.ts**: Real-`QueryClient` coverage of optimistic transitions, list membership/ordering across filtered variants, detail/runtime/queue refresh, archive/restore, drop, targeted and identity-less recovery, coalescing, recovery failure, and server-tail/tray parity.
- **api/session-projection-ownership.test.ts**: Ownership ratchet — scans `src/` and fails when code outside `features/session/` composes generated Session query keys, legacy Session cache helpers, or raw Session cache topology.
- **api/pull-request.ts**: Session pull-request read/mark-ready gateway against the generated SDK; owns only the `['session', id, 'pull-request']` key family, and refreshes the session-owned detail projection through `session-projection`.
- **api/pull-request.test.ts**: Envelope unwrap, transport, and schema-validation coverage for the pull-request gateway.
- **use-session.ts**: Session list hooks (`useAllSessions`, `useWorkspaceSessions`, `useUnreadSessionIds`, `useRunningSessionIds`), `WorkspaceSession` row type, memoized row normalization, session layout metadata hydration for app chrome, and node-session reconciliation for workspace rows.
- **global-session-sync-engine.ts**: SSE event-tail engine for the `sessions` scope — parses `ChatGlobalSessionTailEvent`s, deduplicates by `sequenceId`, routes summary events to `onSessionChanged`, and forwards `SnapshotRequired` with its `sessionId` (or `null` on transport error) to `onSnapshotRequired`.
- **global-session-sync-engine.test.ts**: Event sequencing, deduplication, `SnapshotRequired` identity, and transport-error coverage.
- **use-global-session-event-sync.ts**: Adapter hook that wires the sync engine to the projection gateway — translates events into semantic facts via `applySessionTailEvent`, runs targeted/global gap recovery via `recoverProjectionGap`, and owns the resettable five-second fallback poll for active Session-list queries. Owns no query keys itself.
- **use-global-session-event-sync.test.tsx**: Fallback polling, poll restart after events, targeted `SnapshotRequired` recovery, and identity-less transport recovery coverage.
- **use-session-isolation.ts**: Session isolation (worktree) query/mutation hooks — activate, attach, start, cancel, leave — refreshing Session projections through the gateway and Workspace Git queries through their own generated keys.
- **use-session-pull-request.ts**: `useQuery`/`useMutation` hooks over the pull-request gateway, including the open-PR poll cadence.
- **session-isolation-chrome.tsx**: Session isolation chrome container wiring isolation mutations to chat surfaces.
- **isolation-boundary-dialog.tsx / isolation-missing-dialog.tsx**: Dialogs for isolation boundary crossings and missing-isolation recovery.
- **session-pull-request-chrome.tsx**: Runtime adapter for session pull-request chrome on chat surfaces.
- **session-pull-request-chrome-view.tsx**: Pure props rendering seam for session pull-request status/actions.
- **session-pull-request-chrome-view.stories.tsx**: Fixture-driven pull-request chrome states.
- **download-session-zip.ts**: Streams `GET /sessions/:id/export/zip` through `cradleFetch` with `Content-Disposition` filename parsing and typed 404/409 errors.
