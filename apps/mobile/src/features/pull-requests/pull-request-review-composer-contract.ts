export type PullRequestReviewEvent = 'APPROVE' | 'REQUEST_CHANGES'

export interface PullRequestReviewComposerProps {
  initialDraft?: string
  isMutating?: boolean
  onComment: (body: string) => Promise<void>
  onDraftChange?: (body: string) => void
  onReview: (event: PullRequestReviewEvent, body: string) => Promise<void>
}
