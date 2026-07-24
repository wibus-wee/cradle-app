import type { GitGraphCommit } from './types'

// Colors for branch lanes (cycles if more than 8 lanes)
export const LANE_COLORS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#8b5cf6', // violet
  '#06b6d4', // cyan
] as const

interface GraphLine {
  /** Source lane column index */
  fromLane: number
  /** Destination lane column index */
  toLane: number
}

export interface LayoutCommit extends GitGraphCommit {
  lane: number
  totalLanes: number
  /** Number of lane columns needed by this row's visible segments. */
  visibleLaneCount: number
  /**
   * Line segments to draw from the TOP of this row (y=0) to the commit dot (y=HALF).
   * Each segment's color = laneColor(fromLane).
   */
  linesAbove: GraphLine[]
  /**
   * Line segments to draw from the commit dot (y=HALF) to the BOTTOM of this row (y=ROW_HEIGHT).
   * Each segment's color = laneColor(toLane).
   */
  linesBelow: GraphLine[]
}

/**
 * Compute lane assignments and connecting line segments for a list of commits.
 *
 * Algorithm:
 * - `lanes[i]` = SHA of the commit expected to appear next in lane i (null = free).
 * - For each commit (newest-first, as git log --all returns):
 *   1. Find the lane slot waiting for this commit's SHA; claim a new slot if none.
 *   2. Free the slot; assign its first parent to that slot (or an existing slot).
 *   3. Additional parents each claim their own (or an existing) slot.
 *   4. Snapshot the lanes before and after to compute GraphLine segments.
 *
 * Line semantics:
 *   - linesAbove: for each lane that held this commit's SHA → { fromLane: thatLane, toLane: myLane }
 *                 plus straight pass-throughs for all other active lanes.
 *   - linesBelow: parent departures { fromLane: myLane, toLane: parentSlot }
 *                 plus straight pass-throughs for unrelated lanes.
 */
export function computeGraphLayout(commits: GitGraphCommit[]): LayoutCommit[] {
  const lanes: Array<string | null> = []
  const laneMap = new Map<string, number>()

  function firstFreeLane(): number {
    const idx = lanes.indexOf(null)
    if (idx !== -1) {
      return idx
    }
    lanes.push(null)
    return lanes.length - 1
  }

  const result: LayoutCommit[] = []

  for (const commit of commits) {
    const snapshotBefore = [...lanes]

    // Find or claim lane for this commit
    let myLane = laneMap.get(commit.sha) ?? -1
    if (myLane === -1) {
      myLane = firstFreeLane()
    }

    // Free the slot
    lanes[myLane] = null
    laneMap.delete(commit.sha)

    // Assign parents to lane slots
    if (commit.parents.length > 0) {
      // First parent inherits this lane if it doesn't already have one
      if (!laneMap.has(commit.parents[0])) {
        lanes[myLane] = commit.parents[0]
        laneMap.set(commit.parents[0], myLane)
      }
      // Additional parents claim new (or existing) slots
      for (let i = 1; i < commit.parents.length; i++) {
        if (!laneMap.has(commit.parents[i])) {
          const slot = firstFreeLane()
          lanes[slot] = commit.parents[i]
          laneMap.set(commit.parents[i], slot)
        }
      }
    }

    const snapshotAfter = [...lanes]

    // ── Lines above: y=0 → y=HALF ────────────────────────────────────────────
    const linesAbove: GraphLine[] = []
    for (let i = 0; i < snapshotBefore.length; i++) {
      if (snapshotBefore[i] === null) {
        continue
      }
      if (snapshotBefore[i] === commit.sha) {
        // This lane was tracking this commit → converges to the dot
        linesAbove.push({ fromLane: i, toLane: myLane })
      }
      else {
        // Unrelated lane: passes straight through the top half
        linesAbove.push({ fromLane: i, toLane: i })
      }
    }

    // ── Lines below: y=HALF → y=ROW_HEIGHT ───────────────────────────────────
    const linesBelow: GraphLine[] = []
    const targetLanes = new Set<number>()

    const afterIndex = new Map<string, number>()
    for (let k = 0; k < snapshotAfter.length; k++) {
      if (snapshotAfter[k] !== null) {
        afterIndex.set(snapshotAfter[k]!, k)
      }
    }

    for (const parent of commit.parents) {
      const pLane = afterIndex.get(parent) ?? -1
      if (pLane !== -1) {
        targetLanes.add(pLane)
        linesBelow.push({ fromLane: myLane, toLane: pLane })
      }
    }

    // Pass-through lanes: unchanged between before and after, not a parent target
    for (let j = 0; j < snapshotAfter.length; j++) {
      if (
        snapshotAfter[j] !== null
        && snapshotBefore[j] === snapshotAfter[j]
        && !targetLanes.has(j)
      ) {
        linesBelow.push({ fromLane: j, toLane: j })
      }
    }

    result.push({
      ...commit,
      lane: myLane,
      totalLanes: 1, // patched below
      visibleLaneCount: Math.max(
        1,
        myLane + 1,
        ...linesAbove.map(line => Math.max(line.fromLane + 1, line.toLane + 1)),
        ...linesBelow.map(line => Math.max(line.fromLane + 1, line.toLane + 1)),
      ),
      linesAbove,
      linesBelow,
    })
  }

  // Compute global totalLanes as the max column index seen
  const maxLanes = Math.max(
    1,
    ...result.map(c =>
      Math.max(
        c.lane + 1,
        ...c.linesAbove.map(l => Math.max(l.fromLane + 1, l.toLane + 1)),
        ...c.linesBelow.map(l => Math.max(l.fromLane + 1, l.toLane + 1)),
      )),
  )
  for (const c of result) {
    c.totalLanes = maxLanes
  }

  return result
}
