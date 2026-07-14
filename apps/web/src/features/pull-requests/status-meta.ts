// Shared status helper for the Pull Requests list and detail panel.
//
// Status is conveyed by a leading icon whose shape AND color double-encode
// PR state (draft/ready/merged/closed) - the same idiom GitHub and Linear
// use. This means we never need a separate colored pill or status dot next
// to it; the icon carries the meaning on its own.

import {
  GitMergeLine,
  GitPullRequestCloseLine,
  GitPullRequestLine,
} from '@mingcute/react'
import type { ComponentType, SVGProps } from 'react'

export type PrStatus = 'draft' | 'ready' | 'merged' | 'closed'

export type StatusIconType = ComponentType<SVGProps<SVGSVGElement>>

/**
 * Minimum structural shape needed to derive a PR status. The session PR
 *  detail projection satisfies this.
 */
interface PrStatusFields {
  merged: boolean
  state: 'open' | 'closed'
  isDraft: boolean
}

export function statusKind(pr: PrStatusFields): PrStatus {
  if (pr.merged) {
    return 'merged'
  }
  if (pr.state === 'closed') {
    return 'closed'
  }
  return pr.isDraft ? 'draft' : 'ready'
}

export const STATUS_ICON: Record<PrStatus, StatusIconType> = {
  draft: GitPullRequestLine,
  ready: GitPullRequestLine,
  merged: GitMergeLine,
  closed: GitPullRequestCloseLine,
}

/**
 * Tailwind class for the status icon's color. Merged uses violet directly
 *  (no semantic token for it) to match GitHub/Linear's recognizable merged
 *  color - the same escape hatch used for one-off status colors elsewhere
 *  (see host-enrollments-section.tsx).
 */
export const STATUS_ICON_CLASS: Record<PrStatus, string> = {
  draft: 'text-muted-foreground',
  ready: 'text-success',
  merged: 'text-violet-500 dark:text-violet-400',
  closed: 'text-destructive',
}

export type ChecksState = 'success' | 'failure' | 'pending' | 'neutral'

/**
 * Background color for the small corner badge dot overlaid on the status
 * icon in the list row, signaling CI/check state independently of PR
 * lifecycle state. `neutral` (no checks configured on this PR) renders no
 * dot at all rather than a colorless placeholder.
 */
export const CHECKS_DOT_CLASS: Record<ChecksState, string | null> = {
  success: 'bg-success',
  failure: 'bg-destructive',
  pending: 'bg-warning',
  neutral: null,
}
