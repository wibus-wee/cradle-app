const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000
const RECONNECT_JITTER_RATIO = 0.2

/**
 * Return a bounded exponential reconnect delay with symmetric jitter.
 * Attempt zero starts at one second; repeated failures cap at thirty seconds.
 */
export function remoteHostReconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt))
  const exponentialDelay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** normalizedAttempt,
    RECONNECT_MAX_DELAY_MS,
  )
  const jitterMultiplier = 1 - RECONNECT_JITTER_RATIO + random() * RECONNECT_JITTER_RATIO * 2
  return Math.round(exponentialDelay * jitterMultiplier)
}
