/**
 * Diff deep-link search contract, owned by the diff-review domain.
 *
 * This module is a leaf on purpose: the Navigation surface codec consumes
 * these primitives to model `/diff` and `/workspaces/$workspaceId/diffs`
 * search, and the route files consume them in `validateSearch`. Keeping it
 * free of router/feature imports avoids a navigation↔feature cycle.
 */

/** Search shared by the global and workspace-scoped diff routes. */
export interface DiffsViewSearch {
  workspace?: string
  repo?: string
  path?: string
  review?: string
  line?: number
  side?: DiffAnchorSide
  github?: string
}

export const DIFF_ANCHOR_SIDES = ['base', 'head'] as const

export type DiffAnchorSide = (typeof DIFF_ANCHOR_SIDES)[number]

/**
 * Coerce a route search value (string from the URL, or number from in-memory navigation) into a
 * positive integer. Used by the diff route `validateSearch` schemas so `line` arrives typed.
 */
export function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return parsed > 0 ? parsed : undefined
  }
  return undefined
}

export function parseAnchorSide(value: unknown): DiffAnchorSide | undefined {
  return value === 'base' || value === 'head' ? value : undefined
}
