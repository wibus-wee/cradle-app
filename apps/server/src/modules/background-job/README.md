<!-- Once this directory changes, update this README.md -->

# Background Job Module

The background-job module owns durable asynchronous job lifecycle semantics for the Cradle server. It stores pending, running, succeeded, failed, and cancelled jobs; polls registered sources of truth; retries incomplete owner projection after restart; and exposes reusable list, get, and cancel APIs.

The module does not own product artifacts. Product modules register an owner projector keyed by `ownerNamespace` and job `kind`; that callback remains responsible for parsing results and writing its own domain tables. Source integrations register adapters keyed by `sourceKind`.

## Files

- **index.ts**: Elysia list, get, and cancel routes with generated CLI metadata; registers built-in source adapters.
- **model.ts**: TypeBox schemas for reusable Background Job API responses and filters.
- **service.ts**: Durable lifecycle transitions, querying, reconciliation, terminal projection retry, and idempotent cancellation.
- **poller.ts**: Periodic and explicitly requested reconciliation without per-job in-memory waiters.
- **registry.ts**: Source adapter and owner projector registries.
- **types.ts**: Job views and extension contracts.
- **sources/chat-runtime.ts**: Chat Runtime adapter backed by durable `backend_runs` state.

## Lifecycle and recovery

Source observations are written to `background_jobs` before an owner projector runs. Terminal rows keep `projectedAt` empty until their owner callback succeeds, so startup and periodic polling can retry a projection after a crash. Source polling only changes pending or running rows; once cancellation or another terminal state is persisted, late source completion cannot overwrite it.

Cancellation first marks the job cancelled, then asks the source adapter to abort its work, and finally projects cancellation into the owner domain. Repeated cancellation returns the existing terminal job.
