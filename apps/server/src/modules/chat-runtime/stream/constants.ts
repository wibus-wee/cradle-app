export const DEFAULT_RUN_DELTA_FLUSH_MS = 16
export const DEFAULT_RUN_DELTA_FLUSH_CHARS = 8_192
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 10_000
/**
 * Hard cap on how many chunks a single run's SSE replay buffer
 * (`activeRun.chunkBuffer`) may hold. Defense against an upstream chunk
 * storm (e.g. a runtime re-pushing a non-coalescable chunk type) growing the
 * buffer without bound for the lifetime of a single streaming run, mirroring
 * the same cap already applied to provider-thread replay buffers.
 */
export const DEFAULT_RUN_REPLAY_CHUNKS = 5_000
/**
 * Upper bound on how long `waitForRunCompletion` will wait for a run to reach
 * a terminal DB status. Without this, a run whose terminal chunk never
 * arrives (e.g. process shutdown clears the active-run registry without
 * publishing a terminal event to subscribers) leaves every waiter's promise
 * pending forever.
 */
export const DEFAULT_RUN_WAIT_TIMEOUT_MS = 10 * 60 * 1000
