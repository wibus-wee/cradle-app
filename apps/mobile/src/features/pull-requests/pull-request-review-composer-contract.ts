export type PullRequestReviewEvent = 'APPROVE' | 'REQUEST_CHANGES'

export interface PullRequestReviewComposerProps {
  isMutating?: boolean
  onComment: (body: string) => Promise<void>
  onReview: (event: PullRequestReviewEvent, body: string) => Promise<void>
}
