# Recall Module

Recall owns a rebuildable evidence projection over canonical chat messages, backend runs, run snapshot tool events, and extracted file touches. Live Chat Runtime writes call the same projector functions used by repair; Recall never owns the source rows.

Normal startup performs one bounded reconciliation batch per source instead of deleting and rewriting the full projection. The periodic Maintenance activity repeats that idempotent reconciliation, with at most 500 missing messages, runs, tool events, and orphaned tool events handled per invocation. `repairRecallProjection` remains the explicit destructive full rebuild for operator-directed corruption recovery and is never scheduled automatically.

Recall rows are disposable evidence, so tool events carry retention: the `prune-tool-events` Maintenance activity deletes `recall_tool_events` older than `CRADLE_RECALL_TOOL_EVENT_RETENTION_DAYS` (default 30, 0 disables) in 500-row transactions bounded by the activity deadline, and `recall_file_touches` rows cascade away with their parent events. Source rows in `backend_run_snapshot_events` are unaffected — they carry their own retention in chat-runtime.

<!-- Once this directory changes, update this README.md -->
