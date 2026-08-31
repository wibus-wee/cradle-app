import type { GetWorksByIdResponse } from '@/api-gen'

export interface WorkHandoff {
  title: string
  summary: string
  testPlan: string
}

export interface WorkDetailViewProps {
  detail: GetWorksByIdResponse
  isPreparing?: boolean
  isSubmitting?: boolean
  onOpenPullRequest: (owner: string, repo: string, number: number) => void
  onPrepare: (handoff: WorkHandoff) => Promise<void>
  onSubmit: (handoff: WorkHandoff) => Promise<void>
}
