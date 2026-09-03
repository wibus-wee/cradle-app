import type { GetWorksByIdResponse } from '@/api-gen'

import type { WorkHandoff } from './work-detail-view-contract'

export function initialWorkHandoff(detail: GetWorksByIdResponse): WorkHandoff {
  return {
    title: detail.work.handoffTitle ?? detail.work.title,
    summary: detail.work.handoffSummary ?? '',
    testPlan: detail.work.handoffTestPlan ?? '',
  }
}

export function hasCompleteWorkHandoff(handoff: WorkHandoff): boolean {
  return Boolean(handoff.title.trim() && handoff.summary.trim() && handoff.testPlan.trim())
}

export function workSubmissionBlocker(detail: GetWorksByIdResponse): string | null {
  if (!detail.readiness.isolated) {
    return 'A healthy isolated checkout is required before delivery.'
  }
  if (!detail.readiness.clean) {
    const noun = detail.readiness.changedFiles === 1 ? 'file' : 'files'
    return `Commit or discard ${detail.readiness.changedFiles} changed ${noun} before delivery.`
  }
  if (detail.readiness.commitsAhead === 0) {
    return `Commit at least one change ahead of ${detail.readiness.baseRef ?? 'the base branch'} before delivery.`
  }
  return null
}
