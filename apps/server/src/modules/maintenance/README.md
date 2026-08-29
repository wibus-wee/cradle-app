<!-- Once this directory changes, update this README.md -->

# Maintenance Module

The maintenance module owns process-local scheduling mechanics for bounded server maintenance. It registers each task in Background Activity, applies stable per-task jitter, starts tasks once or on an interval, preserves single-flight execution, supplies a deadline and the optional footer presentation reporter, and stops timers during server shutdown.

It does not import product schemas, select cleanup candidates, define retention periods, or compact the database by itself. Each owning module registers a callback and keeps its Drizzle transaction and deletion semantics local. Database-only cleanup commits one bounded batch at a time. Cross-resource cleanup such as Turn Checkpoint Git refs requires an owner-owned durable recovery lifecycle.

Current registrations reconcile Recall projections, compact and prune run snapshots, prune the GitHub response cache, scrub deleted Composer payloads, recover Turn Checkpoint cleanup, measure stale worktree storage during low server load, and rotate the server log. Database compaction is registered as a manual-only activity, uses the database provider's checked replacement path, and rejects execution while a chat run is active or starting. No task automatically deletes sessions, Codex native history, observability history, or Diff Review audit history.

## Files

- **service.ts**: task registration, Background Activity adapter, automatic/manual run-source propagation, run-on-start and interval scheduling, stable jitter, deadlines, and shutdown/reset lifecycle.
