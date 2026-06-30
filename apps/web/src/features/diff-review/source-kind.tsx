import {
  ArrowRightDownLine as ExternalImportIcon,
  CircleDashLine as CircleDashIcon,
  CloseCircleLine as CloseCircleIcon,
  DotCircleLine as DotCircleIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as GitCompareIcon,
  GitMergeLine as GitMergeIcon,
  GitPullRequestLine as GitPullRequestIcon,
  PlusLine as PlusIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'
import type { ComponentType } from 'react'

import { reviewNeedsAttention } from './shared/diff-items'
import type { CradleDiffReview, ReviewSourceKind } from './shared/types'

type IconType = ComponentType<{ className?: string }>

/**
 * Monochrome glyph per change source kind. No tint this version — the shape
 * carries the taxonomy. Indexed (not called) at render sites so the icon type
 * is a stable reference, not a component created during render.
 */
export const SOURCE_KIND_ICONS: Record<ReviewSourceKind, IconType> = {
  'local-working-tree': PlusIcon,
  'agent-change-set': SparklesIcon,
  'github-pull-request': GitPullRequestIcon,
  'local-branch-compare': GitCompareIcon,
  'local-commit': GitCommitIcon,
  'external-import': ExternalImportIcon,
}

export interface StatusGlyph {
  icon: IconType
  label: string
}

/**
 * Monochrome status glyph for a review. No color this version — the shape
 * itself carries the semantics (open / needs-attention / merged / closed).
 */
export function statusGlyph(review: CradleDiffReview): StatusGlyph {
  if (review.status === 'merged') {
    return { icon: GitMergeIcon, label: 'Merged' }
  }
  if (review.status === 'closed') {
    return { icon: CloseCircleIcon, label: 'Closed' }
  }
  if (review.status === 'abandoned') {
    return { icon: CloseCircleIcon, label: 'Abandoned' }
  }
  // open
  if (reviewNeedsAttention(review)) {
    return { icon: DotCircleIcon, label: 'Needs attention' }
  }
  return { icon: CircleDashIcon, label: 'Open' }
}
