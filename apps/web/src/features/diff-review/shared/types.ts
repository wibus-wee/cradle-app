import type {
  GetWorkspacesByWorkspaceIdDiffReviewsResponse,
  PostWorkspacesByWorkspaceIdDiffReviewsLocalWorkingTreeResponse,
} from '~/api-gen/types.gen'

/** A single Cradle diff review, regardless of how it was sourced. */
export type CradleDiffReview
  = | PostWorkspacesByWorkspaceIdDiffReviewsLocalWorkingTreeResponse
    | GetWorkspacesByWorkspaceIdDiffReviewsResponse[number]

export type ReviewFile = CradleDiffReview['files'][number]
export type ReviewThread = CradleDiffReview['threads'][number]
export type ReviewThreadAnchor = NonNullable<ReviewThread['anchor']>
export type ReviewComment = ReviewThread['comments'][number]
export type ReviewEvent = CradleDiffReview['events'][number]
export type ReviewSubmission = CradleDiffReview['submissions'][number]
export type ReviewGuideStep = CradleDiffReview['guide']['steps'][number]
export type ReviewGuideAnchor = ReviewGuideStep['anchors'][number]
export type ReviewCommitPlan = CradleDiffReview['commitPlans'][number]
export type ReviewAgentFix = CradleDiffReview['agentFixes'][number]
export type ReviewCommitPlanGroup = ReviewCommitPlan['groups'][number]
export type ReviewPreferences = CradleDiffReview['preferences']
export type ReviewRevision = NonNullable<CradleDiffReview['currentRevision']>
export type ReviewSourceKind = CradleDiffReview['sourceKind']
export type ReviewDecision = 'approve' | 'request-changes' | 'comment'

export type EditableCommitPlanStatus = Extract<ReviewCommitPlan['status'], 'draft' | 'accepted' | 'abandoned'>
export type DiffStyle = 'split' | 'unified'

export interface GenerateGuideInput {
  providerTargetId: string
  runtimeKind?: string
  modelId?: string | null
  force?: boolean
}

/** Route param token that selects the live working-tree review (no persisted id). */
export const WORKING_TREE_REVIEW_ID = 'working-tree'

export function isWorkingTreeReviewId(reviewId: string): boolean {
  return reviewId === WORKING_TREE_REVIEW_ID
}

export interface ReviewThreadAnchorInput {
  fileId: string
  side: 'base' | 'head'
  startLine: number
  endLine?: number
}
