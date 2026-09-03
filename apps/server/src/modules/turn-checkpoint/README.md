# Turn Checkpoint module

This module owns hidden Git snapshots for chat turns, checkpoint lifecycle metadata, diff totals, and workspace restore. It writes refs under `refs/cradle/checkpoints` with an isolated temporary Git index, so capture never mutates the user's branch or index.

The capability is disabled by default behind the App feature flag `turnCheckpoints`. While disabled, Chat Runtime capture hooks return without inspecting or writing the repository and HTTP checkpoint operations are rejected.

Chat Runtime calls `captureRunStart` and `captureRunEnd` as best-effort lifecycle hooks. The HTTP `restore` route coordinates the filesystem owner with Chat Runtime's provider/transcript last-turn rollback and restores the latest turn's `startRef`. The `rewind` route targets an older completed checkpoint, restores its `endRef`, rolls back every later conversation turn in place, and removes the later checkpoint refs and metadata. Provider runtimes without native in-place rollback remain unsupported; rewind never falls back to provider thread fork.

Cleanup that spans SQLite and Git uses a durable two-phase state. The owner first changes each row to `cleanup_pending` with a reason and claim timestamp, then deletes its hidden refs idempotently, and deletes the row only after Git succeeds. A bounded Maintenance task retries interrupted claims and claims only `capturing` or `failed` checkpoints whose backend run is terminal. Session hard deletion runs the same owner cleanup before the session transaction; a Git failure prevents the session delete and leaves the claim available for retry.

Diff Review remains the owner of durable patch inspection; clients can pass a checkpoint's `startRef` and `endRef` to the existing local branch-compare route.
