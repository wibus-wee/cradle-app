/**
 * Compute settling drain parameters.
 * When upstream stops, we need to drain remaining backlog smoothly.
 *
 * @param backlog - Characters remaining to reveal
 * @param minDrainMs - Minimum drain window (default 180ms)
 * @param maxDrainMs - Maximum drain window (default 520ms)
 * @returns target CPS to drain within the computed window
 */
export function computeSettlingDrain(
  backlog: number,
  minDrainMs = 180,
  maxDrainMs = 520,
): { targetCps: number, drainMs: number } {
  if (backlog <= 0) {
    return { targetCps: 0, drainMs: 0 }
  }

  // drainTargetMs scales with backlog: more chars = longer window (up to max)
  const drainMs = Math.min(maxDrainMs, Math.max(minDrainMs, backlog * 8))
  const targetCps = (backlog / drainMs) * 1000

  return { targetCps, drainMs }
}

/**
 * Compute whether the smoother should enter wake-timer mode.
 * When the display has caught up to the target (backlog ≈ 0) and input is still active,
 * we can stop RAF and use a setTimeout to wake when new content arrives.
 *
 * @param backlog - Current character backlog
 * @param inputActive - Whether upstream is still providing content
 * @param threshold - Backlog threshold below which to sleep (default 2)
 */
export function shouldSleepSmoother(backlog: number, inputActive: boolean, threshold = 2): boolean {
  return inputActive && backlog <= threshold
}
